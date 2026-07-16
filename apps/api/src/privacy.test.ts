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
