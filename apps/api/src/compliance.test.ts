process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { audit, notify } from "./audit.ts";

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
