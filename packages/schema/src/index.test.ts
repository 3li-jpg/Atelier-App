import { test } from "node:test";
import assert from "node:assert/strict";
import { Event, canTransition, CreateSession, ProviderConfig } from "./index.ts";

test("event schema round-trips supervisor output", () => {
  const e = Event.parse({
    ts: "2026-07-05T18:22:31Z",
    type: "tool_call",
    payload: { tool: "bash", command: "npm test", exit_code: 0 },
  });
  assert.equal(e.type, "tool_call");
  assert.throws(() => Event.parse({ ts: "x", type: "nope", payload: {} }));
});

test("FSM allows the happy path and blocks illegal jumps", () => {
  const happy = ["created", "provisioning", "cloning", "setup", "running", "finalizing", "completed"] as const;
  for (let i = 0; i < happy.length - 1; i++) {
    assert.ok(canTransition(happy[i], happy[i + 1]), `${happy[i]} -> ${happy[i + 1]}`);
  }
  assert.ok(canTransition("running", "awaiting_user"));
  assert.ok(canTransition("awaiting_user", "hibernated"));
  assert.ok(canTransition("hibernated", "running"));
  assert.ok(!canTransition("completed", "running"));
  assert.ok(!canTransition("created", "running"));
});

test("create-session applies defaults", () => {
  const s = CreateSession.parse({
    repo_url: "https://github.com/you/repo",
    provider_id: "p1", model_id: "umans-kimi-k2.7", task: "fix the bug",
  });
  assert.equal(s.branch, "main");
  assert.equal(s.permission_mode, "auto");
  assert.equal(s.budgets.max_wall_clock_s, 1800);
});

test("provider config validates", () => {
  ProviderConfig.parse({
    name: "Umans", base_url: "https://api.code.umans.ai/v1", dialect: "openai-chat",
    models: [{ id: "umans-kimi-k2.7", role: "coder", tool_calls: true }],
  });
  assert.throws(() => ProviderConfig.parse({ name: "", base_url: "nope", dialect: "openai-chat", models: [] }));
});
