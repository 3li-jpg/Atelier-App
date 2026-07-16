process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { LEGAL_DOCS, SUBPROCESSORS, getDocBody, currentVersion, requireAcceptances } from "./legal.ts";

test("LEGAL_DOCS has version + effective + file for every doc", () => {
  for (const [id, meta] of Object.entries(LEGAL_DOCS)) {
    assert.ok(meta.version, `${id} missing version`);
    assert.ok(meta.effective, `${id} missing effective`);
    assert.ok(meta.file, `${id} missing file`);
    assert.ok(meta.title, `${id} missing title`);
  }
});

test("getDocBody reads the markdown file", () => {
  const body = getDocBody("terms");
  assert.ok(body.length > 0);
  assert.ok(body.includes("Terms of Use"));
});

test("requireAcceptances returns missing docs for a fresh user", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 2);
  assert.ok(missing.find((m) => m.docId === "terms"));
  assert.ok(missing.find((m) => m.docId === "privacy"));
});

test("requireAcceptances is empty after accepting current versions", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", currentVersion("terms"), "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "privacy", currentVersion("privacy"), "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 0);
});

test("requireAcceptances flags a version bump", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  // accepted an OLD version
  await store.recordAcceptance(uid, "terms", "0.9", "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms"]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].version, currentVersion("terms"));
});

test("SUBPROCESSORS has the expected providers", () => {
  const names = SUBPROCESSORS.map((s) => s.name);
  for (const expected of ["Stripe", "Supabase", "GitHub", "Vercel"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test("recordAcceptance + currentAcceptances round-trip", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "Mozilla");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.0");
});

test("currentAcceptances returns latest version per doc", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "terms", "1.1", "127.0.0.1", "ua");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.1");
});

test("deleteAcceptances clears a user's records", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.deleteAcceptances(uid);
  const acc = await store.currentAcceptances(uid);
  assert.equal(Object.keys(acc).length, 0);
});

import { buildApp } from "./index.ts";
import { Orchestrator } from "./orchestrator.ts";
import { signSession } from "./auth.ts";

class FakeSandbox { async create(){return{id:"m",provider:"fake"}} async destroy(){} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

function legalSetup() {
  const store = new Store(":memory:");
  const orch = new Orchestrator(store, new FakeSandbox() as any);
  return { store, app: buildApp(store, orch) };
}

test("GET /legal lists all current docs", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal");
  assert.equal(res.status, 200);
  const docs = await res.json();
  assert.ok(docs.find((d: any) => d.doc_id === "terms"));
});

test("GET /legal/:docId returns body + version", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal/terms");
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.version, "1.0");
  assert.ok(doc.body.includes("Terms of Use"));
});

test("GET /legal/unknown returns 404", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal/nope");
  assert.equal(res.status, 404);
});

test("POST /legal/accept records acceptance for an authed user", async () => {
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request("/legal/accept", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ docId: "terms", version: "1.0" }),
  });
  assert.equal(res.status, 200);
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.0");
});

test("POST /legal/accept rejects unknown doc", async () => {
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request("/legal/accept", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ docId: "nope", version: "1.0" }),
  });
  assert.equal(res.status, 404);
});

async function makeProvider(app: any, uid: string) {
  const res = await app.request("/providers", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ name: "T", base_url: "https://api.t.com/v1", dialect: "openai-chat", api_key: "sk-aaaaaaaaaaaaaaaaaaaa",
      models: [{ id: "m", role: "coder", tool_calls: true }] }),
  });
  return (await res.json()).id;
}

test("POST /sessions is blocked without terms acceptance (auth configured)", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid"; process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const pid = await makeProvider(app, uid);
  const res = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ branch: "main", provider_id: pid, model_id: "m", task: "t", permission_mode: "auto", budgets: {} }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "acceptance_required");
  delete process.env.GITHUB_OAUTH_CLIENT_ID; delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
});

test("POST /sessions proceeds after accepting terms", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid"; process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const pid = await makeProvider(app, uid);
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  // Active sandbox plan so the pre-existing quota gate (orthogonal to this
  // feature) doesn't block — isolates the acceptance gate under test.
  store.setUserPlan(uid, { product: "sandbox", tier: "plus", status: "active", current_period_start: "2026-01-01 00:00:00" });
  const res = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ branch: "main", provider_id: pid, model_id: "m", task: "t", permission_mode: "auto", budgets: {} }),
  });
  assert.equal(res.status, 201);
  delete process.env.GITHUB_OAUTH_CLIENT_ID; delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
});
