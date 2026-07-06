import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEvent, cursorKey, formatRelTime, stateTone, TERMINAL_STATES } from "./lib.ts";

test("classifyEvent maps known event types and falls back to verbose", () => {
  assert.equal(classifyEvent("assistant_text"), "assistant");
  assert.equal(classifyEvent("tool_call"), "tool_call");
  assert.equal(classifyEvent("question"), "question");
  assert.equal(classifyEvent("user_message"), "user");
  assert.equal(classifyEvent("state_change"), "state");
  assert.equal(classifyEvent("error"), "error");
  assert.equal(classifyEvent("file_diff"), "diff");
  assert.equal(classifyEvent("commit"), "commit");
  assert.equal(classifyEvent("test_run"), "test");
  assert.equal(classifyEvent("plan_update"), "verbose");
  assert.equal(classifyEvent("harness"), "verbose");
  assert.equal(classifyEvent("unknown_future_type"), "verbose");
});

test("cursorKey is namespaced and unique per session", () => {
  assert.equal(cursorKey("abc"), "atelier:cursor:abc");
  assert.notEqual(cursorKey("abc"), cursorKey("abd"));
});

test("formatRelTime parses both ISO and sqlite datetime, treated as UTC", () => {
  const now = Date.UTC(2026, 6, 6, 12, 0, 0); // 2026-07-06 12:00:00Z (month is 0-indexed)
  assert.equal(formatRelTime("2026-07-06T12:00:00Z", now), "0s ago");
  assert.equal(formatRelTime("2026-07-06 11:59:30", now), "30s ago"); // sqlite space format
  assert.equal(formatRelTime("2026-07-06T11:00:00Z", now), "1h ago");
  assert.equal(formatRelTime("2026-07-05T12:00:00Z", now), "1d ago");
  assert.equal(formatRelTime("not-a-date", now), "—");
});

test("stateTone flags terminal and waiting states", () => {
  assert.equal(stateTone("completed"), "ok");
  assert.equal(stateTone("failed"), "bad");
  assert.equal(stateTone("cancelled"), "bad");
  assert.equal(stateTone("awaiting_user"), "warn");
  assert.equal(stateTone("hibernated"), "warn");
  assert.equal(stateTone("running"), "idle");
});

test("TERMINAL_STATES contains the three terminal FSM states", () => {
  for (const s of ["completed", "failed", "cancelled"]) assert.ok(TERMINAL_STATES.has(s));
  assert.ok(!TERMINAL_STATES.has("running"));
});
