// PgStore integration test — needs a real Postgres. Skips unless
// TEST_DATABASE_URL is set (keeps `npm test` hermetic):
//   TEST_DATABASE_URL=postgres://localhost/atelier_test npm test -w @atelier/api
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";

import { test } from "node:test";
import assert from "node:assert/strict";
import { PgStore } from "./pg-store.ts";
import { encryptKey } from "./secrets.ts";

const url = process.env.TEST_DATABASE_URL;

test("PgStore round-trips the whole Store surface", { skip: !url }, async () => {
  const store = await new PgStore(url!).init();
  try {
    // users + token crypto
    const uid = await store.upsertUser(Date.now(), "alice", "Alice", null);
    assert.equal((await store.getUser(uid)).login, "alice");
    await store.storeUserToken(uid, "ghp_secret123");
    assert.equal(await store.getUserToken(uid), "ghp_secret123");

    // providers (bytea ciphertext + JSON columns)
    const pid = await store.createProvider({
      name: "umans", base_url: "https://api.example/v1", dialect: "openai-chat",
      key_ciphertext: encryptKey("sk-test"), models: [{ id: "m1" }], user_id: uid,
    });
    const provider = await store.getProvider(pid);
    assert.equal(provider.models[0].id, "m1");
    assert.equal((await store.listProviders(uid)).length >= 1, true);

    // sessions — timestamps must stay in sqlite's text format so the
    // orchestrator's `new Date(x + "Z")` parsing works unchanged
    const sid = await store.createSession({
      repo_url: "https://x.com/r", branch: "main", provider_id: pid, model_id: "m1",
      task: "t", permission_mode: "auto", budgets: { max_wall_clock_s: 1800 },
      session_token: "tok", user_id: uid,
    });
    const s = await store.getSession(sid);
    assert.match(s.started_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(!Number.isNaN(new Date(s.started_at + "Z").getTime()));

    await store.setSessionState(sid, "provisioning", "m-1");
    await store.touchActivity(sid);
    await store.addBilled(sid, 2500);
    const s2 = await store.getSession(sid);
    assert.equal(s2.machine_id, "m-1");
    assert.equal(s2.billed_seconds, 3); // 2500ms rounds to 3s
    assert.ok(s2.last_activity);
    await store.setSessionState(sid, "completed" as any);
    assert.ok((await store.getSession(sid)).ended_at);

    // events: atomic seq allocation + cursor replay
    for (let i = 0; i < 3; i++) {
      await store.appendEvent(sid, { ts: new Date().toISOString(), type: "assistant_text", payload: { i } });
    }
    const events = await store.eventsAfter(sid, 1);
    assert.deepEqual(events.map((e) => e.seq), [2, 3]);
    assert.deepEqual(events.map((e) => (e.payload as any).i), [1, 2]);
  } finally {
    await store.close();
  }
});
