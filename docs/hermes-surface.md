# Hermes agent surface → Atelier product mapping

Hermes-agent (installed at ~/.hermes/hermes-agent, pinned 0.18.2 in
runner/Dockerfile) runs inside each sandbox as `hermes gateway run` with the
api_server platform on 127.0.0.1:8642. The bridge (runner/hermes-bridge.mjs)
relays its SSE to the Atelier control plane. Routes verified against
gateway/platforms/api_server.py.

## Endpoints the runner uses (or will)
- GET /health, /v1/models, /v1/capabilities, /v1/skills, /v1/toolsets
- POST /v1/runs {input, session_id} → run_id ; GET /v1/runs/{id}/events (SSE)
- POST /v1/runs/{id}/approval {choice: once|deny} ; POST /v1/runs/{id}/stop
- /api/sessions CRUD + /api/sessions/{id}/chat/stream + /fork (persistent chat
  sessions — future upgrade path; today we get multi-turn by reusing
  session_id across /v1/runs, which the bridge already does)

## Toolsets (config.yaml platform_toolsets.api_server) — from toolsets.py
terminal · file · code_execution · web · search · browser · vision · image_gen
· skills · memory · todo · session_search · clarify · cronjob · tts · project
· **delegation** ("Spawn subagents with isolated context for complex subtasks";
delegate_tool.py — parallel batch + background modes, isolated context,
restricted toolsets per child).

Default Atelier set: terminal, file, code_execution, web, skills, memory, todo,
clarify. Optional per-workspace toggles: **delegation (Subagents)**, browser,
search. The supervisor writes the chosen set into config.yaml from the TOOLSETS
env/handshake field (comma-separated).

## SSE event vocabulary (runner/map-event.mjs)
message.delta → assistant_text · tool.started/completed → tool_call (patch/
write_file → file_diff; clarify → question) · approval.requested → approval
· run.completed/failed → state changes. Extend for: todo updates and
delegation (subagent started/completed) events so the UI can render a todo
panel and a subagent activity feed.

## Product model (chat-first)
- "Workspace" = an Atelier session whose task is optional. Empty task → bridge
  skips the initial run and waits for user messages (replies rail). Each user
  message = POST /v1/runs {input, session_id} against the same hermes session
  → multi-turn chat with full agent context.
- Timeline renders: assistant text (streamed), tool calls, file diffs,
  todos, subagent activity, approvals (inline accept/deny), commits.
- BYOC: SANDBOX_PROVIDER env selects fly | daytona | e2b | local
  (packages/sandbox). Free plan = BYOK (model key) + BYOC (user's own
  Daytona/E2B credits). Paid plans = Atelier-hosted compute.
