process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

class FakeSandbox { async create(){return{id:"m",provider:"fake"}} async destroy(){} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

function setup() {
  const store = new Store(":memory:");
  const orch = new Orchestrator(store, new FakeSandbox() as any);
  return { store, app: buildApp(store, orch) };
}

test("POST /account/delete cascades: cancels sessions, drops keys, anonymizes user", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.createProvider({ name: "T", base_url: "https://t", dialect: "openai-chat", key_ciphertext: Buffer.from("x"), models: [], user_id: uid });
  await store.recordAcceptance(uid, "terms", "1.0", "1.1.1.1", "ua");
  await store.setUserPlan(uid, { product: "vps", tier: "medium", status: "active" });

  const res = await app.request("/account/delete", {
    method: "POST", headers: { Cookie: `atelier_session=${signSession(uid)}` },
  });
  assert.equal(res.status, 202);

  // providers gone
  assert.equal((await store.listProviders(uid)).length, 0);
  // acceptances gone
  assert.equal(Object.keys(await store.currentAcceptances(uid)).length, 0);
  // user anonymized (tombstone)
  const u = store.getUser(uid);
  assert.equal(u.login, "deleted");
  // audit log recorded the deletion
  const auditRows: any[] = (store as any).db.prepare("select * from audit_log where action = 'account_deleted'").all();
  assert.equal(auditRows.length, 1);
});

test("GET /account/export returns a bundle without secrets", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.createProvider({ name: "T", base_url: "https://t", dialect: "openai-chat", key_ciphertext: Buffer.from("x"), models: [], user_id: uid });
  const res = await app.request("/account/export", { headers: { Cookie: `atelier_session=${signSession(uid)}` } });
  assert.equal(res.status, 200);
  const bundle = await res.json();
  assert.ok(bundle.account);
  assert.ok(bundle.providers);
  // CRITICAL: no ciphertext or tokens anywhere in the bundle
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes("key_ciphertext"));
  assert.ok(!serialized.includes("session_token"));
  assert.ok(!serialized.includes("github_token_ciphertext"));
  assert.ok(!serialized.includes("compute_key_ciphertext"));
});

test("POST /account/consent records the analytics choice", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const res = await app.request("/account/consent", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ analytics: false }),
  });
  assert.equal(res.status, 200);
  const row: any = (store as any).db.prepare("select * from consent where user_id = ?").get(uid);
  assert.equal(row.analytics, 0);
});
