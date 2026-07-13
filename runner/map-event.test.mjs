// map-event.test.mjs — tests for the extracted event mapper.
// Run: node --test map-event.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapEvent, NOISE } from "./map-event.mjs";

function state() {
  return { pendingRequests: [] };
}

test("message.delta → assistant_text with text", () => {
  const r = mapEvent({ event: "message.delta", delta: "hello" }, state());
  assert.deepEqual(r, { type: "assistant_text", payload: { text: "hello" } });
});

test("tool.started terminal → tool_call running", () => {
  const r = mapEvent({ event: "tool.started", tool: "terminal" }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "terminal", status: "running" } });
});

test("tool.started patch with preview → file_diff with path", () => {
  const r = mapEvent({ event: "tool.started", tool: "patch", preview: "src/auth.ts" }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "src/auth.ts", content: null } });
});

test("tool.started write_file with preview → file_diff with path", () => {
  const r = mapEvent({ event: "tool.started", tool: "write_file", preview: "lib/foo.ts" }, state());
  assert.deepEqual(r, { type: "file_diff", payload: { path: "lib/foo.ts", content: null } });
});

test("tool.started patch without preview falls through to tool_call", () => {
  const r = mapEvent({ event: "tool.started", tool: "patch" }, state());
  assert.deepEqual(r, { type: "tool_call", payload: { tool: "patch", status: "running" } });
});

test("tool.started clarify → question with kind question", () => {
  const s = state();
  const r = mapEvent({ event: "tool.started", tool: "clarify", preview: "Which branch?" }, s);
  assert.deepEqual(r, {
    type: "question",
    payload: { prompt: "Which branch?", options: [], request_id: "clarify", kind: "question" },
  });
  assert.equal(s.pendingRequests.length, 1);
  assert.equal(s.pendingRequests[0].kind, "question");
});

test("tool.completed with error:false → exit_code 0", () => {
  const r = mapEvent({ event: "tool.completed", tool: "terminal", error: false, duration: 1.5 }, state());
  assert.equal(r.payload.exit_code, 0);
  assert.equal(r.payload.status, "done");
});

test("tool.completed with error:true → exit_code 1", () => {
  const r = mapEvent({ event: "tool.completed", tool: "terminal", error: true, duration: 2.0 }, state());
  assert.equal(r.payload.exit_code, 1);
  assert.equal(r.payload.status, "done");
});

test("approval.request → question with kind permission, options approve/deny, pushes to pendingRequests", () => {
  const s = state();
  const r = mapEvent({ event: "approval.request", command: "rm -rf /tmp" }, s);
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

test("run.completed with usage → usage event", () => {
  const r = mapEvent({
    event: "run.completed",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }, state());
  assert.deepEqual(r, {
    type: "usage",
    payload: { input: 100, output: 50, total: 150 },
  });
});

test("run.failed → error event", () => {
  const r = mapEvent({ event: "run.failed", error: "boom" }, state());
  assert.deepEqual(r, { type: "error", payload: { message: "boom" } });
});

test("run.failed without error → default message", () => {
  const r = mapEvent({ event: "run.failed" }, state());
  assert.deepEqual(r, { type: "error", payload: { message: "run failed" } });
});

test("run.cancelled → state_change cancelled", () => {
  const r = mapEvent({ event: "run.cancelled" }, state());
  assert.deepEqual(r, { type: "state_change", payload: { state: "cancelled" } });
});

test("reasoning.available → null", () => {
  const r = mapEvent({ event: "reasoning.available", text: "thinking..." }, state());
  assert.equal(r, null);
});

test("approval.responded → null", () => {
  const r = mapEvent({ event: "approval.responded", choice: "once" }, state());
  assert.equal(r, null);
});

test("unknown event → harness breadcrumb", () => {
  const r = mapEvent({ event: "something.new", foo: "bar" }, state());
  assert.deepEqual(r, { type: "harness", payload: { event: "something.new" } });
});

test("NOISE set contains expected events", () => {
  assert.ok(NOISE.has("reasoning.available"));
  assert.ok(NOISE.has("approval.responded"));
  assert.equal(NOISE.size, 2);
});

test("tool.started todo → todo started with preview", () => {
  const r = mapEvent({ event: "tool.started", tool: "todo", preview: "3 tasks" }, state());
  assert.deepEqual(r, { type: "todo", payload: { status: "started", preview: "3 tasks" } });
});

test("tool.started todo without preview → empty preview", () => {
  const r = mapEvent({ event: "tool.started", tool: "todo" }, state());
  assert.deepEqual(r, { type: "todo", payload: { status: "started", preview: "" } });
});

test("tool.started delegate_task → subagent started with goal", () => {
  const r = mapEvent({ event: "tool.started", tool: "delegate_task", preview: "refactor auth" }, state());
  assert.deepEqual(r, { type: "subagent", payload: { status: "started", goal: "refactor auth" } });
});

test("tool.completed todo no error → todo completed", () => {
  const r = mapEvent({ event: "tool.completed", tool: "todo", duration: 0.4, error: false }, state());
  assert.deepEqual(r, { type: "todo", payload: { status: "completed" } });
});

test("tool.completed todo error → todo failed", () => {
  const r = mapEvent({ event: "tool.completed", tool: "todo", duration: 0.4, error: true }, state());
  assert.deepEqual(r, { type: "todo", payload: { status: "failed" } });
});

test("tool.completed delegate_task no error → subagent completed", () => {
  const r = mapEvent({ event: "tool.completed", tool: "delegate_task", duration: 5.0, error: false }, state());
  assert.deepEqual(r, { type: "subagent", payload: { status: "completed" } });
});

test("tool.completed delegate_task error → subagent failed", () => {
  const r = mapEvent({ event: "tool.completed", tool: "delegate_task", duration: 5.0, error: true }, state());
  assert.deepEqual(r, { type: "subagent", payload: { status: "failed" } });
});
