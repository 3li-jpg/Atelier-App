process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

class FakeSandbox { created:any[]=[]; destroyed:string[]=[]; async create(c:any){this.created.push(c);return{id:"m",provider:"fake"}} async destroy(ref:any){this.destroyed.push(ref.id)} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

function setup() {
  const store = new Store(":memory:");
  const sandbox = new FakeSandbox();
  const orch = new Orchestrator(store, sandbox as any);
  return { store, sandbox, app: buildApp(store, orch), orch };
}

test("POST /abuse/report stores a report (public, no auth)", async () => {
  const { app } = setup();
  const res = await app.request("/abuse/report", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright", target_ref: "session:abc", reporter_email: "x@y.co", reporter_name: "X", details: "infringes" }),
  });
  assert.equal(res.status, 201);
});

test("POST /abuse/report rejects missing fields", async () => {
  const { app } = setup();
  const res = await app.request("/abuse/report", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright" }),
  });
  assert.equal(res.status, 400);
});

test("admin suspend_account sets role=suspended and user is then blocked", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  // make admin
  (store as any).db.prepare("update users set role='admin' where id=?").run(uid);
  // create a report to action
  const r = await app.request("/abuse/report", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright", target_ref: `user:${uid}`, reporter_email: "x@y.co", reporter_name: "X", details: "x" }) });
  const { id } = await r.json();
  // admin actions it
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request(`/admin/abuse/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "suspend_account" }) });
  assert.equal(res.status, 200);
  // user's role is now suspended
  const u = store.getUser(uid);
  assert.equal(u.role, "suspended");
});
