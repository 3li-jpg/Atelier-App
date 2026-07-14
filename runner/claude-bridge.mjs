#!/usr/bin/env node
// claude-bridge.mjs — relays between the Claude Code CLI and the Atelier control
// plane. Produces Atelier Event objects posted to POST /internal/sessions/:id/events.
//
// ponytail: STUB — not yet implemented.
//
// Claude Code CLI does NOT expose an HTTP/SSE serve API like `opencode serve`.
// The real implementation will either:
//   (a) spawn `claude -p` (print mode) in a loop, parse its stdout/JSON
//       output, and map each chunk to an Atelier event; or
//   (b) use the Claude Agent SDK (TypeScript):
//       https://docs.claude.com/en/docs/claude-code/sdk
//       which provides a programmatic query() / streaming API that is
//       straightforward to map to Atelier events.
//
// Custom endpoint / BYOK support:
//   Claude Code CLI reads ANTHROPIC_BASE_URL (or CLAUDE_BASE_URL) and
//   ANTHROPIC_API_KEY from env for proxy / custom-endpoint support. The
//   supervisor passes LLM_BASE_URL and LLM_API_KEY; the real bridge must
//   translate these to the CLI env vars (ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY)
//   before spawning `claude`.
//
// Zero-dependency (Node 22 stdlib only; fetch is global).
// Usage: node claude-bridge.mjs
//   env: SESSION_ID, EVENTS_URL, SESSION_TOKEN, REPLIES_URL, TASK,
//        CLAUDE_MODEL, LLM_BASE_URL, LLM_API_KEY, CLAUDE_AGENT

// ---- env contract (mirrors opencode-bridge.mjs shape) ----
const {
  SESSION_ID = "",
  EVENTS_URL = "",
  SESSION_TOKEN = "",
  REPLIES_URL = "",
  TASK = "",
  CLAUDE_MODEL = "",
  LLM_BASE_URL = "",
  LLM_API_KEY = "",
  CLAUDE_AGENT = "",
} = process.env;

// Step trace to stderr -> machine logs; the only visibility inside the VM.
const log = (...a) => console.error("claude-bridge:", ...a);

// Every fetch gets a deadline; a hung fetch strands the session.
const T = (ms = 15_000) => ({ signal: AbortSignal.timeout(ms) });

function now() { return new Date().toISOString(); }

// ---- control-plane helper ----
// Mirrors opencode-bridge.mjs's postEvents/emit exactly: POST an array of
// Atelier Event objects to EVENTS_URL with Bearer auth.
function postEvent(type, payload) {
  if (!EVENTS_URL) return Promise.resolve();
  const event = { type, payload, ts: now() };
  return fetch(EVENTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SESSION_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([event]),
    ...T(),
  }).then(
    (r) => { if (!r.ok) log(`event post rejected: ${r.status}`); },
    (e) => log(`event post failed: ${e.message}`),
  );
}

// ---- event mapper (placeholder) ----
// ponytail: STUB — not yet implemented.
// Mirrors opencode-map.mjs's mapOpenCodeEvent signature so the structure is
// ready when real Claude Code event mapping lands. The real implementation
// will map Claude Agent SDK / `claude -p` JSON output (streaming text deltas,
// tool calls, tool results, usage) to Atelier event types:
//   assistant_text, tool_call, file_diff, usage, question, state_change.
//
// @param {object} ev    — parsed JSON from the claude CLI / SDK stream.
// @param {object} state — mutable bridge state.
// @returns {{type: string, payload: object} | null}
export function mapClaudeEvent(ev, state) {
  // No-op: returns null for all events. Real mapping lands with the SDK
  // integration (see header comment for the upgrade path).
  return null;
}

// ---- main ----
// ponytail: STUB — not yet implemented.
// This is a no-op scaffold: it emits running → assistant_text (not implemented
// message) → completed → exit 0 so the session doesn't hang while the real
// integration is pending.
async function main() {
  log("stub mode — Claude Code CLI engine not yet implemented");
  await postEvent("state_change", { state: "running" });

  if (TASK) {
    await postEvent("assistant_text", {
      text: "[Claude Code CLI engine is not yet implemented. This is a stub — the task was not executed. Set ENGINE=opencode (default) for a working agent session.]",
    });
  }

  await postEvent("state_change", { state: "completed" });
  process.exit(0);
}

// ---- graceful shutdown ----
// SIGTERM/SIGINT: emit cancelled state and exit 0.
// The supervisor's finalize() handles git commit/push; we just need to
// release the process cleanly without hanging the session.
const shutdown = async () => {
  log("shutdown signal received");
  try {
    await postEvent("state_change", { state: "cancelled" });
  } catch {}
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch(async (e) => {
  console.error(`claude-bridge: fatal: ${e.message}`);
  try { await postEvent("error", { message: e.message }); } catch {}
  process.exit(1);
});
