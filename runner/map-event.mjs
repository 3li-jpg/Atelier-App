// map-event.mjs — maps parsed Hermes SSE JSON objects to Atelier event objects.
// Pure function module, extracted from the bridge for testability.
//
// Hermes SSE wire format: `data: {json}\n\n` — no `event:` SSE field.
// The event type lives inside the JSON as `data.event`.
//
// Event shapes verified against Hermes source:
//   ~/.hermes/hermes-agent/gateway/platforms/api_server.py
//   (_make_run_event_callback, _handle_runs, _handle_run_approval)

// Events that carry no actionable content — drop entirely.
export const NOISE = new Set([
  "reasoning.available",
  "approval.responded",
]);

/**
 * Map a parsed Hermes SSE JSON object to an Atelier event.
 *
 * @param {object} data   — parsed JSON from the SSE `data:` line.
 * @param {object} state  — mutable bridge state; must have `pendingRequests` array.
 * @returns {{type: string, payload: object} | null}
 *   Returns null for noise events; otherwise { type, payload }.
 */
export function mapEvent(data, state) {
  const evt = data.event ?? "";

  // ---- noise ----
  if (NOISE.has(evt)) return null;

  // ---- streaming assistant text ----
  if (evt === "message.delta") {
    const text = data.delta ?? "";
    return { type: "assistant_text", payload: { text } };
  }

  // ---- tool lifecycle ----
  if (evt === "tool.started") {
    // File-producing tools — surface as file_diff so the web UI can render them.
    if (data.tool === "patch" || data.tool === "write_file") {
      if (typeof data.preview === "string" && data.preview) {
        return { type: "file_diff", payload: { path: data.preview, content: null } };
      }
      // No preview string — fall through to a regular tool_call.
    }
    // Clarify tool — the agent is asking the user a question.
    if (data.tool === "clarify") {
      const prompt = data.preview || "Clarification needed";
      state.pendingRequests.push({ id: "clarify", kind: "question" });
      return {
        type: "question",
        payload: { prompt, options: [], request_id: "clarify", kind: "question" },
      };
    }
    // Default tool started.
    return { type: "tool_call", payload: { tool: data.tool, status: "running" } };
  }

  if (evt === "tool.completed") {
    return {
      type: "tool_call",
      payload: {
        tool: data.tool,
        status: "done",
        exit_code: data.error ? 1 : 0,
        duration: data.duration,
      },
    };
  }

  // ---- approval request (permission prompt) ----
  if (evt === "approval.request") {
    state.pendingRequests.push({ id: "approval", kind: "permission" });
    return {
      type: "question",
      payload: {
        prompt: data.command,
        options: ["approve", "deny"],
        request_id: "approval",
        kind: "permission",
      },
    };
  }

  // ---- run lifecycle ----
  if (evt === "run.completed") {
    const u = data.usage ?? {};
    return {
      type: "usage",
      payload: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        total: u.total_tokens ?? 0,
      },
    };
  }

  if (evt === "run.failed") {
    return { type: "error", payload: { message: data.error ?? "run failed" } };
  }

  if (evt === "run.cancelled") {
    return { type: "state_change", payload: { state: "cancelled" } };
  }

  // ---- unknown, non-noise -> harness breadcrumb ----
  return { type: "harness", payload: { event: evt } };
}
