process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SandboxProvider, SandboxRef, SandboxState, MachineInfo } from "@atelier/sandbox";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

class FakeSandbox implements SandboxProvider {
  created: any[] = [];
  destroyed: string[] = [];
  calls: string[] = [];
  async create(cfg: any): Promise<SandboxRef> { this.created.push(cfg); return { id: "m-1", provider: "fake" }; }
  async suspend() { this.calls.push("suspend"); }
  async resume() { this.calls.push("resume"); }
  async stop() { this.calls.push("stop"); }
  async destroy(ref: SandboxRef) { this.destroyed.push(ref.id); }
  async status(): Promise<SandboxState> { return "started"; }
  async waitFor() {}
  async listMachines(): Promise<MachineInfo[]> { return []; }
}

function setup() {
  const store = new Store(":memory:");
  const sandbox = new FakeSandbox();
  const orch = new Orchestrator(store, sandbox);
  const app = buildApp(store, orch);
  return { store, sandbox, app, orch };
}

// The sandbox billing route only enforces when auth is configured, so the
// billing tests must opt into a real auth mode to hit the 402 paths.
function enableAuth(t: any) {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  t.after(() => { delete process.env.GITHUB_OAUTH_CLIENT_ID; delete process.env.GITHUB_OAUTH_CLIENT_SECRET; });
}

function makeProvider(store: Store, uid: string, app: any) {
  return async () => {
    const res = await app.request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
      body: JSON.stringify({
        name: "Test", base_url: "https://api.test.com/v1", dialect: "openai-chat",
        api_key: "sk-test-key", models: [{ id: "m", role: "coder" }],
      }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).id;
  };
}

async function createSessionBody(app: any, uid: string, providerId: string) {
  return app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ repo_url: "https://github.com/u/r", provider_id: providerId, model_id: "m", task: "t" }),
  });
}

test("free user creating a session returns 402 OUT_OF_QUOTA", async (t) => {
  enableAuth(t);
  const { store, sandbox, app } = setup();
  const uid = store.upsertUser(1001, "freeuser", null, null);
  store.setUserPlan(uid, { product: "sandbox", tier: "free", status: "active" });
  const getProviderId = makeProvider(store, uid, app);
  const providerId = await getProviderId();

  const res = await createSessionBody(app, uid, providerId);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error, "out of quota");
  assert.equal(body.code, "OUT_OF_QUOTA");
  assert.match(body.upgrade_url, /\/billing\/checkout\?product=sandbox/);
  assert.equal(sandbox.created.length, 0);
});

test("plus user with remaining hours can create a session and fake sandbox receives tier cpus/memory_mb", async (t) => {
  enableAuth(t);
  const { store, sandbox, app } = setup();
  const uid = store.upsertUser(1002, "plususer", null, null);
  store.setUserPlan(uid, { product: "sandbox", tier: "plus", status: "active", current_period_start: "2026-01-01 00:00:00" });
  const getProviderId = makeProvider(store, uid, app);
  const providerId = await getProviderId();

  const res = await createSessionBody(app, uid, providerId);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.state, "created");
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(sandbox.created.length, 1);
  const cfg = sandbox.created[0];
  assert.equal(cfg.cpus, 1);
  assert.equal(cfg.memory_mb, 2048);

  const session = store.getSession(body.id);
  assert.equal(session.cpus, 1);
  assert.equal(session.memory_mb, 2048);
});

test("plus user who has exhausted included hours returns 402 OUT_OF_QUOTA", async (t) => {
  enableAuth(t);
  const { store, sandbox, app } = setup();
  const uid = store.upsertUser(1003, "plusexhausted", null, null);
  // All current tiers use meter overage; the spec still requires that we block
  // at zero remaining_hours. To make the test deterministic, manually set the
  // user's remaining budget to exhausted by billing past the included hours.
  store.setUserPlan(uid, { product: "sandbox", tier: "plus", status: "active", current_period_start: "2026-01-01 00:00:00" });
  const getProviderId = makeProvider(store, uid, app);
  const providerId = await getProviderId();

  const sid = store.createSession({
    repo_url: "https://x.com/r", branch: "main", provider_id: providerId, model_id: "m", task: "burn",
    permission_mode: "auto", budgets: {}, session_token: "tok", user_id: uid,
  });
  // plus has 20 included hours; bill enough to drive remaining_hours to 0.
  store.addBilled(sid, 20 * 3600 * 1000 + 1000);
  // Sanity check: the store should report no remaining hours.
  assert.equal(store.getUserUsage(uid).remaining_hours, 0);

  const res = await createSessionBody(app, uid, providerId);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error, "out of quota");
  assert.equal(body.code, "OUT_OF_QUOTA");
  assert.equal(sandbox.created.length, 0);
});

test("missing authentication returns 401", async (t) => {
  enableAuth(t);
  const { app } = setup();
  const res = await app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: "https://github.com/u/r", provider_id: "p", model_id: "m", task: "t" }),
  });
  assert.equal(res.status, 401);
});

test("canceled sandbox plan returns 402 PLAN_REQUIRED", async (t) => {
  enableAuth(t);
  const { store, sandbox, app } = setup();
  const uid = store.upsertUser(1004, "canceleduser", null, null);
  store.setUserPlan(uid, { product: "sandbox", tier: "plus", status: "canceled", current_period_start: "2026-01-01 00:00:00" });
  const getProviderId = makeProvider(store, uid, app);
  const providerId = await getProviderId();

  const res = await createSessionBody(app, uid, providerId);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error, "plan required");
  assert.equal(body.code, "PLAN_REQUIRED");
  assert.equal(sandbox.created.length, 0);
});

test("hard_cap tier with remaining hours uses configured resources", async (t) => {
  enableAuth(t);
  // Pro (metered) still passes when there are remaining hours; this verifies
  // resource sizing is independent of overage mode.
  const { store, sandbox, app } = setup();
  const uid = store.upsertUser(1005, "prouser", null, null);
  store.setUserPlan(uid, { product: "sandbox", tier: "pro", status: "active", current_period_start: "2026-01-01 00:00:00" });
  const getProviderId = makeProvider(store, uid, app);
  const providerId = await getProviderId();

  const res = await createSessionBody(app, uid, providerId);
  assert.equal(res.status, 201);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sandbox.created.length, 1);
  assert.equal(sandbox.created[0].cpus, 2);
  assert.equal(sandbox.created[0].memory_mb, 2048);
});
