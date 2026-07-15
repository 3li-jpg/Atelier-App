#!/usr/bin/env bash
# Supervisor — runs as PID 1 in the Fly VM, or as a local subprocess when
# SANDBOX=local (the LocalSandboxProvider spawns this). Two config modes:
#  - sealed-box handshake (production): HANDSHAKE_URL set → fetch secrets encrypted
#  - env vars (spike / manual curl runs, guide §1.2): REPO_URL etc. set directly
set -euo pipefail
EVENTS_URL="${EVENTS_URL:-}"
SESSION_TOKEN="${SESSION_TOKEN:-}"
WORKSPACE="${WORKSPACE:-/workspace}"
RUNNER_BIN="${RUNNER_BIN:-/usr/local/bin}"
mkdir -p "$WORKSPACE"

if [[ -n "${HANDSHAKE_URL:-}" ]]; then
  CONFIG_JSON=$(node "${RUNNER_BIN}/handshake.mjs")
  REPO_URL=$(jq -r '.repo_url // empty' <<<"$CONFIG_JSON")
  BRANCH=$(jq -r '.branch // "main"' <<<"$CONFIG_JSON")
  TASK=$(jq -r .task <<<"$CONFIG_JSON")
  LLM_BASE_URL=$(jq -r .llm_base_url <<<"$CONFIG_JSON")
  LLM_API_KEY=$(jq -r .llm_api_key <<<"$CONFIG_JSON")
  LLM_MODEL=$(jq -r .llm_model <<<"$CONFIG_JSON")
  GIT_TOKEN=$(jq -r .git_token <<<"$CONFIG_JSON")
  TOOLSETS_HS=$(jq -r '(.toolsets // []) | map(select(type=="string")) | join(",")' <<<"$CONFIG_JSON")
  [[ -n "$TOOLSETS_HS" ]] && TOOLSETS="$TOOLSETS_HS"
  PERMISSION_MODE=$(jq -r '.permission_mode // "auto"' <<<"$CONFIG_JSON")
  unset CONFIG_JSON
fi
: "${LLM_BASE_URL:?}" "${LLM_API_KEY:?}" "${LLM_MODEL:?}"
BRANCH="${BRANCH:-main}"
GIT_TOKEN="${GIT_TOKEN:-}"   # empty for public repos (local/dev); push is skipped
# REPO_URL is optional: a blank workspace (Cursor-like scratchpad) skips clone
# and the git finalize lifecycle entirely — the agent runs in an empty repo dir.
HAS_REPO=0
if [[ -n "${REPO_URL:-}" ]]; then HAS_REPO=1; fi

emit() { # emit <type> <json-payload> — stdout always, control plane if configured
  local line
  line=$(jq -cn --arg t "$1" --argjson p "$2" '{type:$t, payload:$p, ts:(now|todate)}')
  echo "$line" | tee -a "$WORKSPACE/events.jsonl"
  if [[ -n "$EVENTS_URL" ]]; then
    curl -fsS -m 10 -X POST "$EVENTS_URL" \
      -H "Authorization: Bearer $SESSION_TOKEN" -H "Content-Type: application/json" \
      -d "[$line]" >/dev/null || true   # never let telemetry kill the session
  fi
}

# Toolsets: handshake .toolsets > env TOOLSETS > default. Validate against a
# whitelist; drop unknown names, never fail the boot over a toolset.
TOOLSETS_WHITELIST="terminal file code_execution web search browser skills memory todo clarify delegation cronjob vision"
DEFAULT_TOOLSETS="terminal,file,code_execution,web,skills,memory,todo,clarify"
RAW_TOOLSETS="${TOOLSETS:-$DEFAULT_TOOLSETS}"
VALID_TOOLSETS=""
for t in ${RAW_TOOLSETS//,/ }; do
  [[ -z "$t" ]] && continue
  if [[ " $TOOLSETS_WHITELIST " == *" $t "* ]]; then
    VALID_TOOLSETS="${VALID_TOOLSETS:+$VALID_TOOLSETS,}$t"
  else
    emit error "{\"message\":\"dropping unknown toolset: $t\"}" 2>/dev/null || true
  fi
done
[[ -z "$VALID_TOOLSETS" ]] && VALID_TOOLSETS="$DEFAULT_TOOLSETS"

# ponytail: surface any crash (clone failure, agent error, etc.) as a failed
# state so the session doesn't hang in a transient state.
trap 'ec=$?; if [ $ec -ne 0 ]; then emit error "{\"message\":\"supervisor exited ($ec)\"}" 2>/dev/null || true; emit state_change "{\"state\":\"failed\"}" 2>/dev/null || true; fi' EXIT

CAN_PUSH=0
CRED_FILE=""
if [[ "$HAS_REPO" == 1 ]]; then
  emit state_change '{"state":"cloning"}'
  # Capture clone stderr so a failed clone is diagnosable after the VM is gone.
  # The generic EXIT-trap message ("supervisor exited (128)") alone is useless —
  # the real cause used to live only in machine logs that die with the VM.
  CLONE_LOG="$WORKSPACE/clone.log"
  clone_fail_event() {  # emit clone stderr (scrubbed) + hint, then exit non-zero so the trap marks failed
    cat "$CLONE_LOG" >&2 2>/dev/null || true   # also mirror to machine stderr
    local detail=""
    if [[ -s "$CLONE_LOG" ]]; then
      # tail ~400 chars; scrub the token from any x-access-token:<token>@ URL echo
      detail=$(tail -c 400 "$CLONE_LOG" | sed -E 's#x-access-token:[^@]*@#x-access-token:***@#g' | tr -d '\r')
    fi
    local payload
    payload=$(jq -cn --arg m "git clone failed" --arg d "$detail" '{message:$m, detail:$d}')
    if grep -qiE "could not read Username|Authentication failed|Invalid username or token" "$CLONE_LOG" 2>/dev/null; then
      payload=$(jq -c --arg h "The repo may be private — connect GitHub so Atelier can clone with your token." '.hint=$h' <<<"$payload")
    fi
    emit error "$payload" || true
    exit 128
  }
  if [[ -n "$GIT_TOKEN" ]]; then
    git clone --depth 50 --branch "$BRANCH" \
      "https://x-access-token:${GIT_TOKEN}@${REPO_URL#https://}" "$WORKSPACE/repo" 2>"$CLONE_LOG" \
      || clone_fail_event
    CAN_PUSH=1
    # Stash the token in tmpfs (RAM) for the finalize push and strip it from the
    # stored remote URL so it's not left in .git/config on disk (audit C2/C3).
    CRED_FILE=/dev/shm/atelier-git-cred
    if printf '%s' "$GIT_TOKEN" > "$CRED_FILE" 2>/dev/null; then chmod 600 "$CRED_FILE"; else CRED_FILE=""; fi
    git -C "$WORKSPACE/repo" remote set-url origin "$REPO_URL"
  else
    git clone --depth 50 --branch "$BRANCH" "$REPO_URL" "$WORKSPACE/repo" 2>"$CLONE_LOG" \
      || clone_fail_event
  fi
  unset GIT_TOKEN   # scrub from PID 1 env (audit C3)
  cd "$WORKSPACE/repo"
  git config user.email "agent@atelier.dev"
  git config user.name "Atelier Agent"
else
  # Blank scratchpad workspace — no repo to clone. opencode runs in an empty dir.
  # Emit cloning anyway: the FSM requires provisioning→cloning→setup→running, so
  # skipping it leaves the session stranded in provisioning.
  emit state_change '{"state":"cloning"}'
  mkdir -p "$WORKSPACE/repo"
  cd "$WORKSPACE/repo"
fi

emit state_change '{"state":"setup"}'
# nftables is Linux-only (Fly VM); skip on macOS/local runs.
if [[ -z "${SKIP_FIREWALL:-}" ]]; then
  bash "${RUNNER_BIN}/firewall.sh" "$LLM_BASE_URL" github.com api.github.com \
    codeload.github.com "${EVENTS_URL:-github.com}"
fi

# OpenCode serve — the agent runtime. Config lives on tmpfs (RAM) so the key
# is never written to the persistent rootfs (audit C2: PRD §9.3 "never on disk").
# OPENCODE_HOME → tmpfs so opencode.json + auth stay in memory only.
OPENCODE_CFG=/dev/shm/opencode
if mkdir -p "$OPENCODE_CFG" 2>/dev/null && [ -w "$OPENCODE_CFG" ]; then
  ln -sfn "$OPENCODE_CFG" "$HOME/.opencode"
else
  OPENCODE_CFG="$HOME/.opencode"
  mkdir -p "$OPENCODE_CFG"
fi

# opencode provider + model wiring. Two modes:
#  - LOCAL (SKIP_FIREWALL=1, set by LocalSandboxProvider): the operator's real
#    opencode auth (~/.local/share/opencode/auth.json) already holds a working
#    key for providers like umans-ai. The isolated HOME ($WORKSPACE) would hide
#    it, so we link the real opencode data dir in and route the session to the
#    authenticated provider via "providerID/modelID". No custom provider block,
#    no key in env — the operator's own credentialed provider is reused.
#  - SEALED (Fly / handshake): the key arrives via the handshake; write a custom
#    "atelier" OpenAI-compatible provider pointed at LLM_BASE_URL + LLM_API_KEY.
# ponytail: the canonical opencode model id is "providerID/modelID" (e.g.
# "umans-ai/umans-glm-5.2"); the bridge splits on the first "/" to build the
# {providerID, modelID} object the /message API requires.
# Permission policy fragment for opencode.json (landing: "flip on autopilot").
# - auto: omit the permission block → opencode allows all tools (autopilot).
# - review: every mutating tool asks → opencode pauses, the bridge surfaces a
#   permission question, the user approves/denies via the chip in ChatThread.
# - plan: same ask-policy as review, but the task is prefixed to plan-only.
# Tools mapped to "ask": the file-editing + shell set from opencode-map FILE_TOOLS
# plus bash (terminal). Read-only tools (search, list) stay auto.
PERMISSION_MODE="${PERMISSION_MODE:-auto}"
if [[ "$PERMISSION_MODE" == "review" || "$PERMISSION_MODE" == "plan" ]]; then
  ASK_TOOLS='{"edit":"ask","write":"ask","str_replace":"ask","create":"write","multi_edit":"ask","bash":"ask"}'
  PERMISSION_JSON=",\"permission\":${ASK_TOOLS}"
  if [[ "$PERMISSION_MODE" == "plan" ]]; then
    # plan = review + instruct the agent to only plan, not modify files yet.
    TASK="Plan only — do not edit, write, or run shell commands that mutate the repo. Produce a step-by-step plan and stop. Once the user approves the plan, they will switch you to auto mode. Task: ${TASK}"
  fi
else
  PERMISSION_JSON=""
fi

REAL_OPCODE_DATA="${ATELIER_REAL_HOME:-$HOME}/.local/share/opencode"
if [[ -n "${SKIP_FIREWALL:-}" && -d "$REAL_OPCODE_DATA" ]]; then
  # Local dev: reuse the operator's authenticated providers. Link ONLY
  # auth.json — symlinking the whole dir shares opencode.db (SQLite) across
  # concurrent local sessions → "database is locked". Each session gets its own
  # DB; the credential file is the only thing reused.
  mkdir -p "$HOME/.local/share/opencode"
  [[ -f "$REAL_OPCODE_DATA/auth.json" ]] && ln -sfn "$REAL_OPCODE_DATA/auth.json" "$HOME/.local/share/opencode/auth.json"
  # Local mode reuses the operator's providers (no provider block needed), but
  # still needs the permission policy for review/plan modes. Write a minimal
  # opencode.json carrying only the permission block (empty in auto mode).
  if [[ -n "$PERMISSION_JSON" ]]; then
    echo "{\"permission\":${ASK_TOOLS}}" > "$OPENCODE_CFG/opencode.json"
  else
    echo '{}' > "$OPENCODE_CFG/opencode.json"
  fi
  # Normalize the model id to "providerID/modelID". LLM_MODEL may already carry
  # the provider prefix; if not, OPENCODE_PROVIDER_ID supplies it (default umans-ai).
  if [[ "$LLM_MODEL" == */* ]]; then
    OC_MODEL="$LLM_MODEL"
  else
    OC_MODEL="${OPENCODE_PROVIDER_ID:-umans-ai}/${LLM_MODEL}"
  fi
else
  # Sealed/production BYOK: custom provider with the handshake key.
  PROVIDER_ID="${OPENCODE_PROVIDER_ID:-atelier}"
  cat > "$OPENCODE_CFG/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "${PROVIDER_ID}": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Atelier BYOK",
      "options": {
        "baseURL": "${LLM_BASE_URL}"
      },
      "models": {
        "${LLM_MODEL}": {}
      }
    }
  }${PERMISSION_JSON}
}
EOF
  export OPENCODE_PROVIDER_ATELIER_API_KEY="$LLM_API_KEY"
  OC_MODEL="${PROVIDER_ID}/${LLM_MODEL}"
fi
# API server password (basic auth for the bridge — random per session)
OPENCODE_PASSWORD=$(openssl rand -hex 32)
export OPENCODE_SERVER_USERNAME="opencode"
export OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
# Save for non-opencode engines (e.g. claude-bridge) before PID 1 scrub.
_SAVED_LLM_API_KEY="$LLM_API_KEY"
unset LLM_API_KEY   # scrub from PID 1 env (audit C3) — opencode reads it from env

emit state_change '{"state":"running"}'
REPLIES_URL="${EVENTS_URL%/events}/replies"

# ---- engine selector ---------------------------------------------------
# ENGINE=opencode (default) launches the opencode serve + opencode-bridge pair.
# ENGINE=claude launches the claude-bridge stub (no opencode serve). The bridge
# is responsible for spawning the claude CLI itself.
# ponytail: STUB — claude bridge is a no-op scaffold; real integration pending.
ENGINE="${ENGINE:-opencode}"
case "$ENGINE" in
  opencode)
    # Launch opencode web in the background — it's `opencode serve` + a web UI
    # on the same port. The bridge talks to the API; the Atelier UI embeds the
    # web UI via the API proxy. One process, not two.
    opencode web --hostname 127.0.0.1 --port "${OPENCODE_PORT}" >"$WORKSPACE/opencode.log" 2>&1 &
    OPENCODE_PID=$!
    # ponytail: port+auth discovery for the API proxy. The API reads this to
    # forward /sessions/:id/opencode/* → 127.0.0.1:$OPENCODE_PORT. Same <id8>
    # path convention as the preview route. Deleted on finalize.
    printf '%s\n%s\n' "$OPENCODE_PORT" "$OPENCODE_PASSWORD" > "$WORKSPACE/opencode.web"
    ;;
  claude)
    # No opencode serve — the claude bridge spawns the CLI directly.
    OPENCODE_PID=""
    ;;
  *)
    emit error "{\"message\":\"unknown ENGINE: $ENGINE\"}" || true
    echo "supervisor: unknown ENGINE: $ENGINE (expected opencode|claude)" >&2
    exit 64
    ;;
esac

finalize() {  # graceful stop (fly machine stop -> SIGINT; kill_timeout=120s window)
  trap - TERM INT EXIT
  emit state_change '{"state":"finalizing"}'
  rm -f "$WORKSPACE/opencode.web"  # stale port file would mislead the proxy
  if [[ -n "$BRIDGE_PID" ]]; then kill "$BRIDGE_PID" 2>/dev/null || true; fi
  if [[ -n "$OPENCODE_PID" ]]; then kill "$OPENCODE_PID" 2>/dev/null || true; fi
  cd "$WORKSPACE/repo"
  if [[ "$HAS_REPO" == 1 ]]; then
    if [[ -n "$(git status --porcelain)" || -n "$(git log origin/$BRANCH..HEAD --oneline 2>/dev/null)" ]]; then
      git checkout -b "atelier/$(date +%s)" 2>/dev/null || true
      git add -A
      git diff --cached --quiet || git commit -m "Atelier: ${TASK:0:60}"
      if [[ "$CAN_PUSH" == 1 ]]; then
        if [[ -n "$CRED_FILE" && -f "$CRED_FILE" ]]; then
          # push with the token from the tmpfs cred file (origin URL has no token)
          local auth; auth=$(printf 'x-access-token:%s' "$(cat "$CRED_FILE")" | base64 | tr -d '\n')
          git -c http.extraHeader="Authorization: Basic $auth" push -u origin HEAD \
            && emit commit "{\"branch\":\"$(git branch --show-current)\"}"
          shred -u "$CRED_FILE" 2>/dev/null || rm -f "$CRED_FILE"
        else
          emit error '{"message":"git credential unavailable — changes committed locally only"}'
        fi
      else
        emit error '{"message":"no git token — changes committed locally only"}'
      fi
    fi
  fi
  emit state_change '{"state":"completed"}'
  exit 0
}
trap finalize TERM INT

# Bridge relays engine events to the control plane and injects the initial
# task. It runs for the whole session (idle no longer stops it).
case "$ENGINE" in
  opencode)
    OPENCODE_URL="http://127.0.0.1:${OPENCODE_PORT}" \
      OPENCODE_USER="opencode" OPENCODE_PASSWORD="$OPENCODE_PASSWORD" \
      OPENCODE_MODEL="$OC_MODEL" OPENCODE_AGENT="${OPENCODE_AGENT:-}" \
      REPLIES_URL="$REPLIES_URL" TASK="$TASK" SESSION_ID="${SESSION_ID}" \
      EVENTS_URL="$EVENTS_URL" SESSION_TOKEN="$SESSION_TOKEN" \
      node "${RUNNER_BIN}/opencode-bridge.mjs" >"$WORKSPACE/opencode-bridge.log" 2>&1 &
    BRIDGE_PID=$!
    ;;
  claude)
    # ponytail: STUB — claude-bridge is a no-op scaffold that emits running →
    # message → completed → exit 0. It does not spawn the claude CLI yet.
    CLAUDE_MODEL="$LLM_MODEL" \
      CLAUDE_AGENT="${CLAUDE_AGENT:-}" \
      LLM_BASE_URL="$LLM_BASE_URL" LLM_API_KEY="$_SAVED_LLM_API_KEY" \
      REPLIES_URL="$REPLIES_URL" TASK="$TASK" SESSION_ID="${SESSION_ID}" \
      EVENTS_URL="$EVENTS_URL" SESSION_TOKEN="$SESSION_TOKEN" \
      node "${RUNNER_BIN}/claude-bridge.mjs" &
    BRIDGE_PID=$!
    ;;
esac
wait "$BRIDGE_PID" || ec=$?; ec=${ec:-0}
# Observability: a dead bridge usually means opencode never started. Ship the
# opencode.log tail to the control plane so failures are diagnosable after
# the VM is gone (key lines filtered — config holds the only secret, but
# belt and braces).
if [[ "$ec" != 0 && -f "$WORKSPACE/opencode.log" && -s "$WORKSPACE/opencode.log" ]]; then
  LOG_TAIL=$(tail -c 1500 "$WORKSPACE/opencode.log" | grep -vi 'api_key' || true)
  emit error "$(jq -cn --arg m "opencode.log tail (bridge exit $ec)" --arg d "$LOG_TAIL" '{message:$m, detail:$d}')" || true
fi
# propagate the bridge's exit code: a clean exit (0) must not be misreported as
# failed. The EXIT trap only emits on non-zero, so exit 0 leaves the session in
# its last reported state for the reaper to finalize (audit M3).
exit "$ec"
