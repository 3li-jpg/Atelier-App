#!/usr/bin/env bash
# Supervisor (PID 1). Two config modes:
#  - sealed-box handshake (production): HANDSHAKE_URL set → fetch secrets encrypted
#  - env vars (spike / manual curl runs, guide §1.2): REPO_URL etc. set directly
set -euo pipefail
EVENTS_URL="${EVENTS_URL:-}"          # optional: control-plane event ingest
SESSION_TOKEN="${SESSION_TOKEN:-}"    # bearer for EVENTS_URL + handshake

if [[ -n "${HANDSHAKE_URL:-}" ]]; then
  CONFIG_JSON=$(node /usr/local/bin/handshake.mjs)
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
: "${LLM_BASE_URL:?}" "${LLM_API_KEY:?}" "${LLM_MODEL:?}" "${GIT_TOKEN:?}"
BRANCH="${BRANCH:-main}"

emit() { # emit <type> <json-payload> — stdout always, control plane if configured
  local line
  line=$(jq -cn --arg t "$1" --argjson p "$2" \
    '{type:$t, payload:$p, ts:(now|todate)}')
  echo "$line" | tee -a /workspace/events.jsonl
  if [[ -n "$EVENTS_URL" ]]; then
    curl -fsS -m 10 -X POST "$EVENTS_URL" \
      -H "Authorization: Bearer $SESSION_TOKEN" -H "Content-Type: application/json" \
      -d "[$line]" >/dev/null || true   # never let telemetry kill the session
  fi
}

emit state_change '{"state":"setup"}'
bash /usr/local/bin/firewall.sh "$LLM_BASE_URL" github.com api.github.com \
  codeload.github.com registry.npmjs.org "${EVENTS_URL:-github.com}"

emit state_change '{"state":"cloning"}'
git clone --depth 50 --branch "$BRANCH" \
  "https://x-access-token:${GIT_TOKEN}@${REPO_URL#https://}" /workspace/repo
cd /workspace/repo
git config user.email "agent@atelier.dev"
git config user.name "Atelier Agent"

# Point OpenCode at the custom endpoint (OpenAI-compatible)
mkdir -p ~/.config/opencode
jq -n --arg url "$LLM_BASE_URL" --arg key "$LLM_API_KEY" --arg model "$LLM_MODEL" '{
  provider: { custom: {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: $url, apiKey: $key },
    models: { ($model): { name: $model } } } },
  model: ("custom/" + $model)
}' > ~/.config/opencode/opencode.json

emit state_change '{"state":"running"}'
OC_PASSWORD=$(openssl rand -hex 16)
export OPENCODE_SERVER_PASSWORD="$OC_PASSWORD"
REPLIES_URL="${EVENTS_URL%/events}/replies"
opencode serve --hostname 127.0.0.1 --port 4096 >/workspace/opencode.log 2>&1 &
OC_PID=$!
set +e
OC_PASSWORD=$OC_PASSWORD OC_PORT=4096 REPLIES_URL="$REPLIES_URL" \
  node /usr/local/bin/bridge.mjs
AGENT_EXIT=$?
set -e
kill "$OC_PID" 2>/dev/null || true
wait "$OC_PID" 2>/dev/null || true

emit state_change '{"state":"finalizing"}'
if [[ -n "$(git status --porcelain)" || -n "$(git log origin/$BRANCH..HEAD --oneline 2>/dev/null)" ]]; then
  git checkout -b "atelier/$(date +%s)" 2>/dev/null || true
  git add -A
  git diff --cached --quiet || git commit -m "Atelier: ${TASK:0:60}"
  git push -u origin HEAD
  emit commit "{\"branch\":\"$(git branch --show-current)\"}"
else
  emit error '{"message":"agent made no changes"}'
fi

emit state_change "{\"state\":\"completed\",\"agent_exit\":$AGENT_EXIT}"
