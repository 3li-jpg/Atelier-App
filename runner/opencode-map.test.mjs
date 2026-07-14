// opencode-map.test.mjs — tests for the extracted OpenCode event mapper.
// Run: node --test runner/opencode-map.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpenCodeEvent, NOISE } from "./opencode-map.mjs";

function state() {
  return { pendingRequests: [] };
}

test("EventSessionNextTextDelta → assistant_text with text", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextTextDelta", properties: { text: "hello" } }, state());
  assert.deepEqual(r, { type: "assistant_text", payload: { text: "hello" } });
});

test("EventSessionNextTextDelta with delta field → assistant_text", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextTextDelta", properties: { delta: "world" } }, state());
  assert.deepEqual(r, { type: "assistant_text", payload: { text: "world" } });
});

test("EventSessionNextTextDelta with empty text → null", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextTextDelta", properties: { text: "" } }, state());
  assert.equal(r, null);
});

test("EventSessionNextToolProgress running → tool_call running", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: { name: "terminal" }, state: "running" } }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "terminal", status: "running" } });
});

test("EventSessionNextToolProgress completed → tool_call done exit_code 0", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "terminal", state: "completed", duration: 1.5 } }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "terminal", status: "done", exit_code: 0, duration: 1.5 } });
});

test("EventSessionNextToolProgress completed with error → tool_call done exit_code 1", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "terminal", state: "completed", error: "boom" } }, state());
  assert.equal(r.payload.exit_code, 1);
  assert.equal(r.payload.status, "done");
  assert.equal(r.payload.error, "boom");
});

test("EventSessionNextToolProgress edit tool with path → file_diff with relative path", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "edit", state: "running", path: "src/auth.ts" } }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "src/auth.ts", content: null } });
});

test("EventSessionNextToolProgress write tool with /repo/ path → file_diff with stripped path", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "write", state: "running", path: "/workspace/repo/lib/foo.ts" } }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "lib/foo.ts", content: null } });
});

test("EventSessionNextToolProgress write_file with input.path → file_diff", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "write_file", state: "running", input: { path: "lib/bar.ts" } } }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "lib/bar.ts", content: null } });
});

test("EventSessionNextToolProgress edit tool without path → falls through to tool_call", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionNextToolProgress", properties: { tool: "edit", state: "running" } }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "edit", status: "running" } });
});

test("EventPermissionAsked → question with kind permission, pushes to pendingRequests", () => {
  const s = state();
  const r = mapOpenCodeEvent({ type: "EventPermissionAsked", properties: { prompt: "rm -rf /tmp" } }, s);
  assert.deepEqual(r, {
    type: "question",
    payload: {
      prompt: "rm -rf /tmp",
      options: ["approve", "deny"],
      request_id: "approval",
      kind: "permission",
    },
  });
  assert.equal(s.pendingRequests.length, 1);
  assert.equal(s.pendingRequests[0].kind, "permission");
});

test("EventQuestionAsked → question with kind question, pushes to pendingRequests", () => {
  const s = state();
  const r = mapOpenCodeEvent({ type: "EventQuestionAsked", properties: { prompt: "Which branch?" } }, s);
  assert.deepEqual(r, {
    type: "question",
    payload: {
      prompt: "Which branch?",
      options: [],
      request_id: "clarify",
      kind: "question",
    },
  });
  assert.equal(s.pendingRequests.length, 1);
  assert.equal(s.pendingRequests[0].kind, "question");
});

test("EventSessionUpdated completed with usage → usage event", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "completed", usage: { input: 100, output: 50, total: 150 } } }, state());
  assert.deepEqual(r, {
    type: "usage",
    payload: { input: 100, output: 50, total: 150 },
  });
});

test("EventSessionUpdated completed without usage → state_change completed", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "completed" } }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "completed" } });
});

test("EventSessionUpdated failed → error event", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "failed", error: "boom" } }, state());
  assert.deepEqual(r, { type: "error", payload: { message: "boom" } });
});

test("EventSessionUpdated failed without error → default message", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "failed" } }, state());
  assert.deepEqual(r, { type: "error", payload: { message: "session failed" } });
});

test("EventSessionUpdated cancelled → state_change cancelled", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "cancelled" } }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "cancelled" } });
});

test("EventSessionUpdated with metadata state → null (noise)", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionUpdated", properties: { state: "metadata", title: "new title" } }, state());
  assert.equal(r, null);
});

test("server.connected → null", () => {
  const r = mapOpenCodeEvent({ type: "server.connected", properties: {} }, state());
  assert.equal(r, null);
});

test("EventSessionCreated → null", () => {
  const r = mapOpenCodeEvent({ type: "EventSessionCreated", properties: { id: "abc" } }, state());
  assert.equal(r, null);
});

test("unknown event → harness breadcrumb", () => {
  const r = mapOpenCodeEvent({ type: "something.new", properties: { foo: "bar" } }, state());
  assert.deepEqual(r, { type: "harness", payload: { event: "something.new" } });
});

test("NOISE set contains expected events", () => {
  assert.ok(NOISE.has("server.connected"));
  assert.ok(NOISE.has("EventSessionCreated"));
  assert.equal(NOISE.size, 2);
});
