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
  unset CONFIG_JSON
fi
: "${REPO_URL:?}" "${TASK:?}"
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

# ponytail: surface any crash (clone failure, opencode error, etc.) as a failed
# state so the session doesn't hang in a transient state.
trap 'ec=$?; if [ $ec -ne 0 ]; then emit error "{\"message\":\"supervisor exited ($ec)\"}" 2>/dev/null || true; emit state_change "{\"state\":\"failed\"}" 2>/dev/null || true; fi' EXIT

emit state_change '{"state":"cloning"}'
CAN_PUSH=0
CRED_FILE=""
if [[ -n "$GIT_TOKEN" ]]; then
  git clone --depth 50 --branch "$BRANCH" \
    "https://x-access-token:${GIT_TOKEN}@${REPO_URL#https://}" "$WORKSPACE/repo"
  CAN_PUSH=1
  # Stash the token in tmpfs (RAM) for the finalize push and strip it from the
  # stored remote URL so it's not left in .git/config on disk (audit C2/C3).
  CRED_FILE=/dev/shm/atelier-git-cred
  if printf '%s' "$GIT_TOKEN" > "$CRED_FILE" 2>/dev/null; then chmod 600 "$CRED_FILE"; else CRED_FILE=""; fi
  git -C "$WORKSPACE/repo" remote set-url origin "$REPO_URL"
else
  git clone --depth 50 --branch "$BRANCH" "$REPO_URL" "$WORKSPACE/repo"
fi
unset GIT_TOKEN   # scrub from PID 1 env (audit C3)
cd "$WORKSPACE/repo"
git config user.email "agent@atelier.dev"
git config user.name "Atelier Agent"

emit state_change '{"state":"setup"}'
# nftables is Linux-only (Fly VM); skip on macOS/local runs.
if [[ -z "${SKIP_FIREWALL:-}" ]]; then
  # models.dev: opencode fetches its model catalog at startup and stalls without it
  bash "${RUNNER_BIN}/firewall.sh" "$LLM_BASE_URL" github.com api.github.com \
    codeload.github.com registry.npmjs.org models.dev "${EVENTS_URL:-github.com}"
fi

# Point OpenCode at the custom endpoint. Config lives on tmpfs (RAM) so the key
# is never written to the persistent rootfs (audit C2: PRD §9.3 "never on disk").
# ~/.config/opencode symlinks to the tmpfs dir so opencode finds its default path.
OC_CFG=/dev/shm/opencode
if mkdir -p "$OC_CFG" 2>/dev/null && [ -w "$OC_CFG" ]; then
  mkdir -p "$HOME/.config"
  ln -sfn "$OC_CFG" "$HOME/.config/opencode"   # opencode reads ~/.config/opencode -> tmpfs
else
  OC_CFG="$HOME/.config/opencode"               # ponytail: fallback if tmpfs unavailable
  mkdir -p "$OC_CFG"
fi
jq -n --arg url "$LLM_BASE_URL" --arg key "$LLM_API_KEY" --arg model "$LLM_MODEL" '{
  provider: { custom: {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: $url, apiKey: $key },
    models: { ($model): { name: $model } } } },
  model: ("custom/" + $model)
}' > "$OC_CFG/opencode.json"
unset LLM_API_KEY   # scrub from PID 1 env (audit C3) — opencode reads the key from its config

emit state_change '{"state":"running"}'
REPLIES_URL="${EVENTS_URL%/events}/replies"
# No server password: opencode binds 127.0.0.1 in a single-tenant VM; the
# localhost boundary is the isolation. (openchamber's remote-auth support is
# undocumented — password removed rather than guessed at.)
opencode serve --hostname 127.0.0.1 --port 4096 >"$WORKSPACE/opencode.log" 2>&1 &
OC_PID=$!

# openchamber workspace UI — attaches to the opencode server above; reachable
# from the workspace proxy over Fly 6PN on :3000 (egress firewall only filters
# outbound; established-state replies to inbound connections pass).
# Auth is handled by the workspace proxy (signed cookies); openchamber runs
# unauthenticated on the VM's private network interface.
# --host :: binds IPv6 any (Fly 6PN is IPv6-only); dual-stack accepts IPv4 too.
OPENCODE_SKIP_START=true OPENCODE_HOST=http://127.0.0.1:4096 \
  OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
  openchamber --host :: --port 3000 >"$WORKSPACE/openchamber.log" 2>&1 &
CHAMBER_PID=$!

finalize() {  # graceful stop (fly machine stop -> SIGINT; kill_timeout=120s window)
  trap - TERM INT EXIT
  emit state_change '{"state":"finalizing"}'
  kill "$BRIDGE_PID" "$CHAMBER_PID" "$OC_PID" 2>/dev/null || true
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

# Bridge relays opencode events for the hub timeline and injects the initial
# task; it now runs for the whole session (idle no longer stops it).
OC_PORT=4096 REPLIES_URL="$REPLIES_URL" TASK="$TASK" node "${RUNNER_BIN}/bridge.mjs" &
BRIDGE_PID=$!
wait "$BRIDGE_PID" || ec=$?; ec=${ec:-0}
# propagate the bridge's exit code: a clean exit (0) must not be misreported as
# failed. The EXIT trap only emits on non-zero, so exit 0 leaves the session in
# its last reported state for the reaper to finalize (audit M3).
exit "$ec"
