process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { audit, notify } from "./audit.ts";
import { Orchestrator } from "./orchestrator.ts";

class FakeSandbox { destroyed:string[]=[]; async create(){return{id:"m",provider:"fake"}} async destroy(ref:any){this.destroyed.push(ref.id)} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

test("sweepRetention purges old terminal-session events", async () => {
  const store = new Store(":memory:");
  const orch = new Orchestrator(store, new FakeSandbox() as any);
  // seed an old terminal session with events
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const sid = await store.createSession({ branch:"main", provider_id:"p", model_id:"m", task:"t", permission_mode:"auto", budgets:{}, session_token:"tok", user_id: uid });
  await store.setSessionState(sid, "completed");
  // backdate the events
  (store as any).db.prepare("update events set ts = ? where session_id = ?").run("2020-01-01 00:00:00", sid);
  await orch.sweepRetention();
  const remaining: any[] = (store as any).db.prepare("select * from events where session_id = ?").all(sid);
  assert.equal(remaining.length, 0);
});

test("sweepRetention destroys VPS disks canceled past grace", async () => {
  const store = new Store(":memory:");
  const sandbox = new FakeSandbox();
  const orch = new Orchestrator(store, sandbox as any);
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.setUserPlan(uid, { product: "vps", tier: "medium", status: "canceled", vm_ref: "vm-1" });
  // backdate: simulate canceled long ago by setting current_period_end to the past
  (store as any).db.prepare("update user_plan set current_period_end = ? where user_id = ?").run("2020-01-01 00:00:00", uid);
  await orch.sweepRetention();
  assert.ok(sandbox.destroyed.includes("vm-1"));
});

test("appendAudit records an entry", async () => {
  const store = new Store(":memory:");
  await audit(store, { actor: "u1", action: "key_added", target: "provider:p1", meta: { name: "Umans" } });
  const rows: any[] = (store as any).db.prepare("select * from audit_log").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "key_added");
  assert.equal(rows[0].actor, "u1");
});

test("audit swallows errors (never breaks the calling path)", async () => {
  // a store with no audit_log table would throw; audit must not propagate
  const broken = { appendAudit: async () => { throw new Error("boom"); } } as any;
  await audit(broken, { actor: "u1", action: "x", target: "t", meta: {} });
  assert.ok(true); // reached here = no throw
});

test("notify stubs to console.warn when no SMTP env", async () => {
  delete process.env.SMTP_URL;
  // should not throw
  await notify("ip@studioatelier.ca", "report", "body");
  assert.ok(true);
});
