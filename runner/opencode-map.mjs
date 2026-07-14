// opencode-map.mjs — maps parsed OpenCode SSE JSON objects to Atelier event objects.
// Pure function module, extracted from the bridge for testability.
//
// OpenCode serve SSE wire format: `data: {json}\n\n` — each SSE event has a
// `type` field (e.g. EventSessionNextTextDelta) and a `properties` object
// carrying the event-specific payload. Exact payload field names are not fully
// published, so all reads are defensive (try multiple likely keys).

// Events that carry no actionable content — drop entirely.
export const NOISE = new Set([
  "server.connected",
  "EventSessionCreated",
]);

// Tool names that produce files inside the workspace — surface as file_diff
// so the web UI can render them in the Files rail. Other tools (terminal,
// search, etc.) stay plain tool_call rows.
const FILE_TOOLS = new Set(["edit", "write", "str_replace", "create", "write_file", "edit_file"]);

/**
 * Map a parsed OpenCode SSE JSON object to an Atelier event.
 *
 * @param {object} ev     — parsed JSON from the SSE `data:` line.
 * @param {object} state  — mutable bridge state; must have `pendingRequests` array.
 * @returns {{type: string, payload: object} | null}
 *   Returns null for noise events; otherwise { type, payload }.
 */
export function mapOpenCodeEvent(ev, state) {
  const type = ev.type ?? "";
  const p = ev.properties ?? {};

  // ---- noise ----
  if (NOISE.has(type)) return null;

  // ---- streaming assistant text ----
  if (type === "EventSessionNextTextDelta") {
    const text = p.text || p.delta || p.content || "";
    if (!text) return null;
    return { type: "assistant_text", payload: { text } };
  }

  // ---- tool lifecycle ----
  if (type === "EventSessionNextToolProgress") {
    const tool = p.tool?.name || p.tool || p.title || p.name || "tool";
    const toolState = p.state || p.step || p.status || "";

    // File-producing tools — surface as file_diff so the web UI can render
    // them, but only for files inside the workspace repo. Agents also write
    // scratch files (e.g. /var/folders/...) that are not part of the change
    // set — those stay plain tool_calls.
    if (FILE_TOOLS.has(tool)) {
      const path = p.path || p.file || (p.input && p.input.path) || "";
      if (path) {
        const i = path.indexOf("/repo/");
        if (i >= 0) {
          return { type: "file_diff", payload: { path: path.slice(i + 6), content: null } };
        }
        if (!path.startsWith("/")) {
          return { type: "file_diff", payload: { path, content: null } };
        }
        // Absolute path outside the repo — scratch file; fall through to tool_call.
      }
      // No usable path — fall through to a regular tool_call.
    }

    if (toolState === "running" || toolState === "started" || toolState === "pending") {
      return { type: "tool_call", payload: { tool, status: "running" } };
    }

    // completed or any other terminal state → done
    const payload = {
      tool,
      status: "done",
      exit_code: p.error ? 1 : 0,
    };
    if (p.duration != null) payload.duration = p.duration;
    if (p.error) payload.error = String(p.error);
    return { type: "tool_call", payload };
  }

  // ---- permission request (approval prompt) ----
  if (type === "EventPermissionAsked") {
    state.pendingRequests.push({ id: "approval", kind: "permission" });
    return {
      type: "question",
      payload: {
        prompt: p.prompt || p.message || p.command || "Permission required",
        options: ["approve", "deny"],
        request_id: "approval",
        kind: "permission",
      },
    };
  }

  // ---- question asked (clarify) ----
  if (type === "EventQuestionAsked") {
    state.pendingRequests.push({ id: "clarify", kind: "question" });
    return {
      type: "question",
      payload: {
        prompt: p.prompt || p.question || p.message || "Clarification needed",
        options: [],
        request_id: "clarify",
        kind: "question",
      },
    };
  }

  // ---- session lifecycle ----
  if (type === "EventSessionUpdated") {
    const status = p.state || p.status || "";
    if (status === "completed" || status === "finished" || status === "done") {
      const u = p.usage ?? p.tokens ?? {};
      const input = u.input ?? u.input_tokens ?? 0;
      const output = u.output ?? u.output_tokens ?? 0;
      const total = u.total ?? u.total_tokens ?? (input + output);
      if (input || output || total) {
        return { type: "usage", payload: { input, output, total } };
      }
      return { type: "state_change", payload: { state: "completed" } };
    }
    if (status === "failed" || status === "error") {
      return { type: "error", payload: { message: p.error || p.message || "session failed" } };
    }
    if (status === "cancelled" || status === "aborted") {
      return { type: "state_change", payload: { state: "cancelled" } };
    }
    // Other session updates (metadata, title changes) — noise.
    return null;
  }

  // ---- unknown, non-noise → harness breadcrumb ----
  return { type: "harness", payload: { event: type } };
}
