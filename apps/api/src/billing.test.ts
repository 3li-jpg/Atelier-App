process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";
import * as billing from "./billing.ts";

class FakeSandbox {
  created: any[] = [];
  destroyed: string[] = [];
  calls: string[] = [];
  async create(cfg: any): Promise<any> { this.created.push(cfg); return { id: "m-1", provider: "fake" }; }
  async suspend() { this.calls.push("suspend"); }
  async resume() { this.calls.push("resume"); }
  async stop() { this.calls.push("stop"); }
  async destroy(ref: any) { this.destroyed.push(ref.id); }
  async status(): Promise<any> { return "started"; }
  async waitFor() {}
  async listMachines(): Promise<any[]> { return []; }
}

function setup() {
  const store = new Store(":memory:");
  const sandbox = new FakeSandbox();
  const orch = new Orchestrator(store, sandbox);
  const app = buildApp(store, orch);
  return { store, app };
}

function mockStripe(checkoutUrl = "https://checkout.stripe.test/session", portalUrl = "https://billing.stripe.test/portal") {
  const calls: any[] = [];
  const client = {
    checkout: { sessions: { create: async (params: any) => { calls.push({ method: "checkout.sessions.create", params }); return { url: checkoutUrl, id: "cs_test_123" }; } } },
    billingPortal: { sessions: { create: async (params: any) => { calls.push({ method: "billingPortal.sessions.create", params }); return { url: portalUrl }; } } },
    webhooks: { constructEvent: (body: any, signature: any, secret: any) => { calls.push({ method: "webhooks.constructEvent", body, signature, secret }); return { type: "invoice.paid", data: { object: {} } }; } },
  };
  billing.setStripeClient(client);
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
  return { client, calls };
}

test("checkout route returns a Stripe URL", async () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const { store, app } = setup();
  const { calls } = mockStripe();
  const uid = store.upsertUser(1, "alice", null, null);
  const cookie = `atelier_session=${signSession(uid)}`;

  const res = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ product: "sandbox", tier: "plus" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, "https://checkout.stripe.test/session");
  assert.equal(calls[0].method, "checkout.sessions.create");
  assert.equal(calls[0].params.mode, "subscription");
  assert.equal(calls[0].params.subscription_data.trial_period_days, 3);
  assert.equal(calls[0].params.subscription_data.payment_method_collection, "always");

  delete process.env.SESSION_SECRET;
});

test("portal route returns a Stripe URL", async () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const { store, app } = setup();
  const { calls } = mockStripe();
  const uid = store.upsertUser(2, "bob", null, null);
  const cookie = `atelier_session=${signSession(uid)}`;

  const res = await app.request("/billing/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ customerId: "cus_123" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, "https://billing.stripe.test/portal");
  assert.equal(calls[0].method, "billingPortal.sessions.create");
  assert.equal(calls[0].params.customer, "cus_123");

  delete process.env.SESSION_SECRET;
});

test("webhook route verifies signature and returns event type", async () => {
  const { app } = setup();
  mockStripe();

  const res = await app.request("/billing/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "sig_123" },
    body: JSON.stringify({ id: "evt_1", type: "invoice.paid" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.event, "invoice.paid");
});

test("billing routes require authentication", async () => {
  const { app } = setup();
  let res = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product: "sandbox", tier: "plus" }),
  });
  assert.equal(res.status, 401);

  res = await app.request("/billing/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId: "cus_123" }),
  });
  assert.equal(res.status, 401);
});

test("checkout route validates product and tier/size", async () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const { store, app } = setup();
  mockStripe();
  const uid = store.upsertUser(3, "carol", null, null);
  const cookie = `atelier_session=${signSession(uid)}`;

  let res = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ product: "unknown" }),
  });
  assert.equal(res.status, 400);

  res = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ product: "sandbox" }),
  });
  assert.equal(res.status, 400);

  res = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ product: "vps" }),
  });
  assert.equal(res.status, 400);

  delete process.env.SESSION_SECRET;
});

test("getUserUsage returns correct used_hours from billed_seconds", async () => {
  const { store } = setup();
  const uid = store.upsertUser(4, "dave", null, null);
  store.setUserPlan(uid, { product: "sandbox", tier: "plus", status: "active", current_period_start: "2026-01-01 00:00:00" });

  // create a provider and a session so the FK-ish user_id query works
  const pid = store.createProvider({ name: "P", base_url: "https://p.io/v1", dialect: "openai-chat", key_ciphertext: Buffer.from("x"), models: [{ id: "m" }], user_id: uid });
  const sid = store.createSession({ repo_url: "https://github.com/d/r", branch: "main", provider_id: pid, model_id: "m", task: "t", permission_mode: "auto", budgets: {}, session_token: "tok", user_id: uid });
  store.addBilled(sid, 3600_000); // 3600 seconds = 1 hour

  const usage = store.getUserUsage(uid);
  assert.ok(usage);
  assert.equal(usage.product, "sandbox");
  assert.equal(usage.tier, "plus");
  assert.equal(usage.included_hours, 20);
  assert.equal(usage.used_hours, 1);
  assert.equal(usage.remaining_hours, 19);
});

test("getUserUsage for VPS has no hour usage", async () => {
  const { store } = setup();
  const uid = store.upsertUser(5, "eve", null, null);
  store.setUserPlan(uid, { product: "vps", tier: "medium", status: "active" });

  const usage = store.getUserUsage(uid);
  assert.ok(usage);
  assert.equal(usage.product, "vps");
  assert.equal(usage.tier, "medium");
  assert.equal(usage.used_hours, 0);
  assert.equal(usage.remaining_hours, null);
  assert.equal(usage.included_hours, null);
});
