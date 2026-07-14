# Agent engines

The Atelier runner is engine-agnostic. The control plane only consumes Atelier
Event objects posted to `POST /internal/sessions/:id/events` — it does not know
or care which agent runtime produced them. The `supervisor.sh` script selects
which engine to launch inside the sandbox VM.

## ENGINE env var

```
ENGINE=opencode   # default — opencode serve + opencode-bridge.mjs
ENGINE=claude     # stub   — claude-bridge.mjs (not yet implemented)
```

Set `ENGINE` in the sandbox machine env (or locally for `SANDBOX=local` runs).
The supervisor branches after the clone/firewall/config phase; everything
before and after (git clone, firewall, finalize/commit/push) is identical.

## Current engines

| Engine     | Bridge              | Status      | Notes                                              |
|------------|---------------------|-------------|----------------------------------------------------|
| `opencode` | `opencode-bridge.mjs` | Default, working | Launches `opencode serve` (SSE), relays events. |
| `claude`   | `claude-bridge.mjs`  | Stub       | No-op scaffold. Emits running → message → completed. |

## Atelier Event types

Bridges emit these event types (defined in `packages/schema`):

- `state_change` — `{ state: "cloning" | "setup" | "running" | "completed" | "cancelled" | "failed" }`
- `assistant_text` — `{ text: string }`
- `tool_call` — `{ tool: string, status: "running" | "done", exit_code?: number }`
- `file_diff` — `{ path: string, content: string | null }`
- `usage` — `{ input: number, output: number, total: number }`
- `question` — `{ prompt: string, options: string[], request_id: string, kind: "permission" | "question" }`
- `error` — `{ message: string, detail?: string }`
- `commit` — `{ branch: string }`

## Adding a new engine

1. **Write a bridge** — `runner/<engine>-bridge.mjs` (Node 22 ESM, zero deps).
   It must:
   - Read the env contract: `TASK`, `EVENTS_URL`, `SESSION_TOKEN`, `REPLIES_URL`,
     `SESSION_ID`, plus engine-specific vars (model, base URL, API key).
   - POST Atelier Event objects to `EVENTS_URL` with `Authorization: Bearer $SESSION_TOKEN`.
   - Emit `state_change { state: "running" }` on start, `completed` on finish,
     `cancelled` on SIGTERM.
   - Handle SIGTERM/SIGINT without hanging the session.

2. **Write a mapper** — `runner/<engine>-map.mjs` (pure function, like
   `opencode-map.mjs`). Maps the engine's native event format to Atelier events.

3. **Add a branch in `supervisor.sh`** — inside the `case "$ENGINE"` block,
   launch your bridge with the env contract. The `finalize()`, `emit()`, trap,
   git, and firewall logic stays unchanged.
