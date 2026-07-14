// opencode-map.mjs — maps OpenCode serve (v1.17) SSE JSON to Atelier Event objects.
// Pure function module, extracted from the bridge for testability.
//
// OpenCode serve SSE wire format: `data: {json}\n\n`. Each event has a `type`
// and a `properties` payload. The session id lives in `properties.sessionID`
// (the bridge filters on it before calling here). Verified against opencode
// 1.17.15 by capturing the live stream:
//   message.part.delta    — streaming token deltas; properties.delta is a text
//                           fragment (field:"text" for prose, "reasoning" for
//                           chain-of-thought).
//   message.part.updated  — part lifecycle; properties.part.type ∈
//                           {text, reasoning, tool, patch, step-start,
//                           step-finish}. Tool parts carry part.tool,
//                           part.state.status, part.state.input/output.
//   session.status        — properties.status.type ∈ {busy, idle}.
//   session.idle          — agent finished its turn (→ awaiting_user).
//   session.diff          — file changes (properties.diff[]).

// Events that carry no actionable content — drop entirely.
export const NOISE = new Set([
  "server.connected",
  "server.heartbeat",
  "session.updated",
  "catalog.updated",
  "reference.updated",
  "integration.updated",
  "plugin.added",
  "message.updated",
]);

// Tool names that produce files inside the workspace — surface as file_diff
// so the web UI renders them in the Files rail. Other tools (terminal,
// search, etc.) stay plain tool_call rows.
const FILE_TOOLS = new Set(["edit", "write", "str_replace", "create", "write_file", "edit_file", "multi_edit"]);

// Workspace repo root marker — opencode runs with cwd = $WORKSPACE/repo, so
// tool paths are absolute under it. Relativize to the repo root for display.
const REPO_MARKER = "/repo/";

function relativize(path) {
  if (!path) return "";
  const i = path.indexOf(REPO_MARKER);
  if (i >= 0) return path.slice(i + REPO_MARKER.length);
  if (!path.startsWith("/")) return path;
  return "";
}

/**
 * Map a parsed OpenCode SSE JSON object to an Atelier event.
 *
 * @param {object} ev     — parsed JSON from the SSE `data:` line.
 * @param {object} state  — mutable bridge state; must have `pendingRequests` array.
 * @returns {{type: string, payload: object} | null}
 *   Returns null for noise; otherwise { type, payload }.
 */
export function mapOpenCodeEvent(ev, state) {
  const type = ev.type ?? "";
  const p = ev.properties ?? {};

  if (NOISE.has(type)) return null;

  // ---- streaming assistant text (token deltas) ----
  // message.part.delta: properties.field is "text" for prose, "reasoning" for CoT.
  // Only prose becomes assistant_text; reasoning is dropped (not surfaced yet).
  if (type === "message.part.delta") {
    if (p.field && p.field !== "text") return null;
    const text = p.delta ?? p.text ?? "";
    if (!text) return null;
    return { type: "assistant_text", payload: { text } };
  }

  // ---- part lifecycle ----
  if (type === "message.part.updated") {
    const part = p.part ?? {};
    const pt = part.type ?? "";

    // text part lifecycle — deltas (message.part.delta) are the primary path
    // and carry every token. Re-emitting part.text here overlays the full
    // accumulated text on top of the deltas → the answer appears 2-3×
    // (verified against a live run: "7 times 8 is 56" printed three times).
    if (pt === "text") return null;

    // reasoning / step markers — not surfaced.
    if (pt === "reasoning" || pt === "step-start" || pt === "step-finish") return null;

    // File patch summary — surface as a file_diff if it carries a path.
    if (pt === "patch") {
      const path = relativize(part.path ?? part.filePath ?? "");
      if (!path) return null;
      return { type: "file_diff", payload: { path, content: null } };
    }

    // Tool invocation lifecycle.
    if (pt === "tool") {
      const tool = part.tool ?? "tool";
      const st = part.state ?? {};
      const status = st.status ?? "";
      const input = st.input ?? {};

      // File-producing tools — surface as file_diff with content when available.
      if (FILE_TOOLS.has(tool)) {
        const rawPath = input.filePath ?? input.path ?? st.metadata?.filepath ?? st.title ?? "";
        const path = relativize(rawPath);
        if (path) {
          const content = typeof input.content === "string" ? input.content : null;
          return { type: "file_diff", payload: { path, content } };
        }
        // No usable path — fall through to a regular tool_call.
      }

      const payload = { tool, status: status === "completed" || status === "done" ? "done" : "running" };
      if (status === "completed" || status === "done") {
        const out = st.output;
        if (typeof out === "string" && out) payload.result = out;
        if (st.time?.end && st.time?.start) payload.duration = st.time.end - st.time.start;
      }
      return { type: "tool_call", payload };
    }

    return null;
  }

  // ---- session status: busy/idle → state_change ----
  if (type === "session.status") {
    const s = p.status?.type ?? p.status ?? "";
    if (s === "busy") return { type: "state_change", payload: { state: "running" } };
    if (s === "idle") return { type: "state_change", payload: { state: "awaiting_user" } };
    return null;
  }

  // ---- session idle: agent turn finished ----
  if (type === "session.idle") {
    return { type: "state_change", payload: { state: "awaiting_user" } };
  }

  // ---- file diff summary ----
  if (type === "session.diff") {
    const diff = p.diff;
    if (!Array.isArray(diff) || diff.length === 0) return null;
    // Emit one file_diff per changed path.
    const paths = diff.map((d) => relativize(d.path ?? d.file ?? "")).filter(Boolean);
    if (paths.length === 0) return null;
    // ponytail: emit the first; the bridge batches. Multiple paths would need
    // multiple events — return the first, the rest surface via tool parts.
    return { type: "file_diff", payload: { path: paths[0], content: null } };
  }

  // ---- unknown, non-noise → harness breadcrumb (keeps visibility) ----
  return { type: "harness", payload: { event: type } };
}
