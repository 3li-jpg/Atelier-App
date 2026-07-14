// opencode-map.test.mjs — tests for the OpenCode event mapper (v1.17 schema).
// Run: node --test runner/opencode-map.test.mjs
// Event shapes verified against a live `opencode serve` 1.17.15 SSE capture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpenCodeEvent, NOISE } from "./opencode-map.mjs";

function state() {
  return { pendingRequests: [] };
}

// ---- streaming text (message.part.delta) ----

test("message.part.delta text field → assistant_text", () => {
  const r = mapOpenCodeEvent({ type: "message.part.delta", properties: { delta: "Hello", field: "text" } }, state());
  assert.deepEqual(r, { type: "assistant_text", payload: { text: "Hello" } });
});

test("message.part.delta without explicit field defaults to text → assistant_text", () => {
  const r = mapOpenCodeEvent({ type: "message.part.delta", properties: { delta: "world" } }, state());
  assert.deepEqual(r, { type: "assistant_text", payload: { text: "world" } });
});

test("message.part.delta reasoning field → null (not surfaced)", () => {
  const r = mapOpenCodeEvent({ type: "message.part.delta", properties: { delta: "thinking...", field: "reasoning" } }, state());
  assert.equal(r, null);
});

test("message.part.delta empty delta → null", () => {
  const r = mapOpenCodeEvent({ type: "message.part.delta", properties: { delta: "", field: "text" } }, state());
  assert.equal(r, null);
});

// ---- part lifecycle (message.part.updated) ----

// text part lifecycle must NOT re-emit — deltas carry every token, and
// re-emitting part.text overlays the full text on the accumulated deltas,
// duplicating the answer (regression: live run printed "7 times 8 is 56" 3×).
test("message.part.updated text part → null (deltas are the source of truth)", () => {
  const r = mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "text", text: "Done." } } }, state());
  assert.equal(r, null);
});

test("message.part.updated reasoning part → null", () => {
  const r = mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "reasoning", text: "..." } } }, state());
  assert.equal(r, null);
});

test("message.part.updated step-start/step-finish → null", () => {
  assert.equal(mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "step-start" } } }, state()), null);
  assert.equal(mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "step-finish" } } }, state()), null);
});

// ---- tool lifecycle (message.part.updated tool part) ----

test("tool part running (terminal) → tool_call running", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "terminal", state: { status: "running", input: {} } } },
  }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "terminal", status: "running" } });
});

test("tool part completed (terminal) → tool_call done with result + duration", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "terminal", state: { status: "completed", output: "ok", time: { start: 1000, end: 1500 } } } },
  }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "terminal", status: "done", result: "ok", duration: 500 } });
});

test("write tool with filePath + content → file_diff with content", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "write", state: { status: "running", input: { filePath: "/workspace/repo/src/a.ts", content: "hi" } } } },
  }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "src/a.ts", content: "hi" } });
});

test("write tool with relative path → file_diff", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "write", state: { status: "running", input: { filePath: "lib/foo.ts", content: "x" } } } },
  }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "lib/foo.ts", content: "x" } });
});

test("write tool non-string content → file_diff content null", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "write", state: { status: "running", input: { filePath: "a.ts", content: { obj: true } } } } },
  }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "a.ts", content: null } });
});

test("write tool without path → falls through to tool_call", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "write", state: { status: "running", input: {} } } },
  }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "write", status: "running" } });
});

test("edit tool with metadata.filepath → file_diff", () => {
  const r = mapOpenCodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "edit", state: { status: "completed", metadata: { filepath: "/workspace/repo/b.ts" } } } },
  }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "b.ts", content: null } });
});

// ---- patch part ----

test("patch part with path → file_diff", () => {
  const r = mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "patch", path: "/workspace/repo/c.ts" } } }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "c.ts", content: null } });
});

test("patch part without path → null", () => {
  const r = mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "patch" } } }, state());
  assert.equal(r, null);
});

// ---- session status ----

test("session.status busy → state_change running", () => {
  const r = mapOpenCodeEvent({ type: "session.status", properties: { status: { type: "busy" } } }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "running" } });
});

test("session.status idle → state_change awaiting_user", () => {
  const r = mapOpenCodeEvent({ type: "session.status", properties: { status: { type: "idle" } } }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "awaiting_user" } });
});

test("session.idle → state_change awaiting_user", () => {
  const r = mapOpenCodeEvent({ type: "session.idle", properties: {} }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "awaiting_user" } });
});

// ---- session diff ----

test("session.diff with paths → file_diff first path", () => {
  const r = mapOpenCodeEvent({ type: "session.diff", properties: { diff: [{ path: "/workspace/repo/d.ts" }] } }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "d.ts", content: null } });
});

test("session.diff empty → null", () => {
  const r = mapOpenCodeEvent({ type: "session.diff", properties: { diff: [] } }, state());
  assert.equal(r, null);
});

// ---- noise ----

test("server.connected → null", () => {
  assert.equal(mapOpenCodeEvent({ type: "server.connected", properties: {} }, state()), null);
});

test("plugin.added → null", () => {
  assert.equal(mapOpenCodeEvent({ type: "plugin.added", properties: {} }, state()), null);
});

test("message.updated → null", () => {
  assert.equal(mapOpenCodeEvent({ type: "message.updated", properties: {} }, state()), null);
});

test("server.heartbeat → null", () => {
  assert.equal(mapOpenCodeEvent({ type: "server.heartbeat", properties: {} }, state()), null);
});

// ---- unknown ----

test("unknown event → harness breadcrumb", () => {
  const r = mapOpenCodeEvent({ type: "something.new", properties: { foo: "bar" } }, state());
  assert.deepEqual(r, { type: "harness", payload: { event: "something.new" } });
});

// ---- permission.asked (review/plan modes) ----

test("permission.asked → question with kind:permission + records pending", () => {
  const s = state();
  const r = mapOpenCodeEvent({
    type: "permission.asked",
    properties: { id: "perm-1", sessionID: "s", permission: "edit" },
  }, s);
  assert.deepEqual(r, {
    type: "question",
    payload: {
      prompt: "Allow edit?",
      options: ["approve", "deny"],
      request_id: "perm-1",
      kind: "permission",
    },
  });
  assert.equal(s.pendingRequests.length, 1);
  assert.equal(s.pendingRequests[0].id, "perm-1");
  assert.equal(s.pendingRequests[0].kind, "permission");
});

test("NOISE set contains expected events", () => {
  assert.ok(NOISE.has("server.connected"));
  assert.ok(NOISE.has("plugin.added"));
  assert.ok(NOISE.has("message.updated"));
  assert.ok(NOISE.has("session.updated"));
});
