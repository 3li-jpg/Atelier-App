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
  REPO_URL=$(jq -r .repo_url <<<"$CONFIG_JSON")
  BRANCH=$(jq -r '.branch // "main"' <<<"$CONFIG_JSON")
  TASK=$(jq -r .task <<<"$CONFIG_JSON")
  LLM_BASE_URL=$(jq -r .llm_base_url <<<"$CONFIG_JSON")
  LLM_API_KEY=$(jq -r .llm_api_key <<<"$CONFIG_JSON")
  LLM_MODEL=$(jq -r .llm_model <<<"$CONFIG_JSON")
  GIT_TOKEN=$(jq -r .git_token <<<"$CONFIG_JSON")
  TOOLSETS_HS=$(jq -r '(.toolsets // []) | map(select(type=="string")) | join(",")' <<<"$CONFIG_JSON")
  [[ -n "$TOOLSETS_HS" ]] && TOOLSETS="$TOOLSETS_HS"
  unset CONFIG_JSON
fi
: "${REPO_URL:?}"
: "${LLM_BASE_URL:?}" "${LLM_API_KEY:?}" "${LLM_MODEL:?}"
BRANCH="${BRANCH:-main}"
GIT_TOKEN="${GIT_TOKEN:-}"   # empty for public repos (local/dev); push is skipped

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

emit state_change '{"state":"cloning"}'
CAN_PUSH=0
CRED_FILE=""
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

# BYOK custom-provider wiring: write an opencode.json pointing the provider
# at the sealed-handshake LLM base_url + model. The API key is set via env
# OPENCODE_PROVIDER_<ID>_API_KEY (opencode reads provider keys from env).
# ponytail: opencode's exact config schema for custom providers is not fully
# documented; this is a reasonable OpenAI-compatible provider entry. If the
# npm adapter name changes, update here — the $schema field helps.
PROVIDER_ID="atelier"
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
  }
}
EOF
export OPENCODE_PROVIDER_ATELIER_API_KEY="$LLM_API_KEY"
# API server password (basic auth for the bridge — random per session)
OPENCODE_PASSWORD=$(openssl rand -hex 32)
export OPENCODE_SERVER_USERNAME="opencode"
export OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
unset LLM_API_KEY   # scrub from PID 1 env (audit C3) — opencode reads it from env

emit state_change '{"state":"running"}'
REPLIES_URL="${EVENTS_URL%/events}/replies"
# Launch opencode serve in the background (the agent runtime)
opencode serve --hostname 127.0.0.1 --port "${OPENCODE_PORT}" >"$WORKSPACE/opencode.log" 2>&1 &
OPENCODE_PID=$!

finalize() {  # graceful stop (fly machine stop -> SIGINT; kill_timeout=120s window)
  trap - TERM INT EXIT
  emit state_change '{"state":"finalizing"}'
  kill "$BRIDGE_PID" "$OPENCODE_PID" 2>/dev/null || true
  cd "$WORKSPACE/repo"
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
  emit state_change '{"state":"completed"}'
  exit 0
}
trap finalize TERM INT

# Bridge relays OpenCode SSE events to the control plane and injects the
# initial task. It runs for the whole session (idle no longer stops it).
OPENCODE_URL="http://127.0.0.1:${OPENCODE_PORT}" \
  OPENCODE_USER="opencode" OPENCODE_PASSWORD="$OPENCODE_PASSWORD" \
  OPENCODE_MODEL="$LLM_MODEL" OPENCODE_AGENT="${OPENCODE_AGENT:-}" \
  REPLIES_URL="$REPLIES_URL" TASK="$TASK" SESSION_ID="${SESSION_ID}" \
  EVENTS_URL="$EVENTS_URL" SESSION_TOKEN="$SESSION_TOKEN" \
  node "${RUNNER_BIN}/opencode-bridge.mjs" &
BRIDGE_PID=$!
wait "$BRIDGE_PID" || ec=$?; ec=${ec:-0}
# Observability: a dead bridge usually means opencode never started. Ship the
# opencode.log tail to the control plane so failures are diagnosable after
# the VM is gone (key lines filtered — config holds the only secret, but
# belt and braces).
if [[ "$ec" != 0 && -s "$WORKSPACE/opencode.log" ]]; then
  LOG_TAIL=$(tail -c 1500 "$WORKSPACE/opencode.log" | grep -vi 'api_key' || true)
  emit error "$(jq -cn --arg m "opencode.log tail (bridge exit $ec)" --arg d "$LOG_TAIL" '{message:$m, detail:$d}')" || true
fi
# propagate the bridge's exit code: a clean exit (0) must not be misreported as
# failed. The EXIT trap only emits on non-zero, so exit 0 leaves the session in
# its last reported state for the reaper to finalize (audit M3).
exit "$ec"
