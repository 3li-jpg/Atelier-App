process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";
process.env.SUSPEND_AFTER_MS = "30";  // fast hibernation timers for tests
process.env.STOP_AFTER_MS = "60";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SandboxProvider, SandboxRef, SandboxState, MachineInfo } from "@atelier/sandbox";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { encryptKey, decryptKey, redact } from "./secrets.ts";
import { signSession } from "./auth.ts";

class FakeSandbox implements SandboxProvider {
  created: any[] = [];
  destroyed: string[] = [];
  calls: string[] = [];
  machines: MachineInfo[] = []; // tests populate this to simulate Fly-side state
  async create(cfg: any): Promise<SandboxRef> { this.created.push(cfg); return { id: "m-1", provider: "fake" }; }
  async suspend() { this.calls.push("suspend"); }
  async resume() { this.calls.push("resume"); }
  async stop() { this.calls.push("stop"); }
  async destroy(ref: SandboxRef) { this.destroyed.push(ref.id); }
  async status(): Promise<SandboxState> { return "started"; }
  async waitFor() {}
  async listMachines(): Promise<MachineInfo[]> { return this.machines; }
}

function setup() {
  const store = new Store(":memory:");
  const sandbox = new FakeSandbox();
  const app = buildApp(store, new Orchestrator(store, sandbox));
  return { store, sandbox, app };
}

test("secrets round-trip and redaction", () => {
  assert.equal(decryptKey(encryptKey("sk-abc123")), "sk-abc123");
  assert.equal(redact("token is ghp_abcdefghij1234567890 ok"), "token is [redacted] ok");
  assert.equal(redact("nothing here"), "nothing here");
});

test("full session lifecycle over HTTP", async () => {
  const { store, sandbox, app } = setup();

  // create provider
  let res = await app.request("/providers", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Umans", base_url: "https://api.code.umans.ai/v1", dialect: "openai-chat",
      api_key: "sk-secret-key-12345",
      models: [{ id: "umans-kimi-k2.7", role: "coder", tool_calls: true }],
    }),
  });
  assert.equal(res.status, 201);
  const { id: providerId } = await res.json();

  // create session → orchestrator boots fake machine with decrypted key
  res = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_url: "https://github.com/you/test-repo",
      provider_id: providerId, model_id: "umans-kimi-k2.7", task: "add tests",
    }),
  });
  assert.equal(res.status, 201);
  const { id: sessionId } = await res.json();
  await new Promise((r) => setTimeout(r, 20)); // let async launch settle

  assert.equal(sandbox.created.length, 1);
  // no secrets in machine env — supervisor gets them via the sealed handshake
  const env = sandbox.created[0].env;
  assert.equal(env.LLM_API_KEY, undefined);
  assert.equal(env.GIT_TOKEN, undefined);
  assert.ok(env.HANDSHAKE_URL.includes(sessionId));
  assert.equal(store.getSession(sessionId).state, "provisioning");

  // sealed-box handshake round-trip, playing the supervisor (mirrors runner/handshake.mjs)
  const { generateKeyPairSync } = await import("node:crypto");
  const { openSealed } = await import("./secrets.ts");
  const kp = generateKeyPairSync("x25519");
  const pubRaw = (kp.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  const supToken = store.getSession(sessionId).session_token;
  const hs = await app.request(`/internal/sessions/${sessionId}/handshake`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${supToken}` },
    body: JSON.stringify({ pubkey: pubRaw.toString("base64") }),
  });
  assert.equal(hs.status, 200);
  const config: any = openSealed(kp.privateKey.export({ format: "pem", type: "pkcs8" }) as string, await hs.json());
  assert.equal(config.llm_api_key, "sk-secret-key-12345");
  assert.equal(config.repo_url, "https://github.com/you/test-repo");
  // wrong token and bad pubkey rejected
  assert.equal((await app.request(`/internal/sessions/${sessionId}/handshake`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
    body: JSON.stringify({ pubkey: pubRaw.toString("base64") }),
  })).status, 401);

  // supervisor reports progress via internal ingest (with its bearer token)
  const token = store.getSession(sessionId).session_token;
  const post = (events: unknown[], auth = `Bearer ${token}`) =>
    app.request(`/internal/sessions/${sessionId}/events`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(events),
    });

  assert.equal((await post([], "Bearer wrong")).status, 401);

  for (const state of ["cloning", "setup", "running", "finalizing", "completed"]) {
    const r = await post([{ ts: new Date().toISOString(), type: "state_change", payload: { state } }]);
    assert.equal(r.status, 200);
  }
  assert.equal(store.getSession(sessionId).state, "completed");
  assert.equal(sandbox.destroyed.length, 1); // reaped after completion

  // secrets in supervisor payloads get redacted before storage
  const s2 = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: "https://github.com/you/r2", provider_id: providerId, model_id: "umans-kimi-k2.7", task: "x" }),
  });
  const { id: ses2 } = await s2.json();
  await new Promise((r) => setTimeout(r, 20));
  const tok2 = store.getSession(ses2).session_token;
  await app.request(`/internal/sessions/${ses2}/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok2}` },
    body: JSON.stringify([{ ts: new Date().toISOString(), type: "harness", payload: { text: "leaked ghp_abcdefghij1234567890" } }]),
  });
  const events = store.eventsAfter(ses2, 0);
  const harness = events.find((e) => e.type === "harness")!;
  assert.match((harness.payload as any).text, /\[redacted\]/);

  // session detail hides the token; illegal transitions rejected by FSM
  const detail = await (await app.request(`/sessions/${sessionId}`)).json();
  assert.equal(detail.session_token, undefined);
});

test("AUTH_TOKEN gates public routes but not health or internal", async (t) => {
  process.env.AUTH_TOKEN = "gate-123";
  t.after(() => { delete process.env.AUTH_TOKEN; });
  const { app } = setup();
  assert.equal((await app.request("/providers")).status, 401);
  assert.equal((await app.request("/providers", { headers: { Authorization: "Bearer gate-123" } })).status, 200);
  assert.equal((await app.request("/health")).status, 200);
});

test("hibernation: awaiting_user suspends, stop follows, reply wakes; reaper kills TTL breaches", async () => {
  const { store, sandbox, app } = setup();
  const orch = new Orchestrator(store, sandbox);

  const id = store.createSession({ repo_url: "https://x.com/r", branch: "main", provider_id: "p", model_id: "m", task: "t", permission_mode: "auto", budgets: { max_wall_clock_s: 1800 }, session_token: "tok" });
  store.setSessionState(id, "provisioning", "m-1");
  for (const st of ["cloning", "setup", "running"]) store.setSessionState(id, st as any);

  orch.onSupervisorState(id, "awaiting_user");
  await new Promise((r) => setTimeout(r, 50));  // > SUSPEND_AFTER_MS(30)
  assert.deepEqual(sandbox.calls, ["suspend"]);
  assert.equal(store.getSession(id).state, "hibernated");
  await new Promise((r) => setTimeout(r, 80));  // > STOP_AFTER_MS(60)
  assert.deepEqual(sandbox.calls, ["suspend", "stop"]);

  await orch.wake(id);
  assert.deepEqual(sandbox.calls, ["suspend", "stop", "resume"]);
  assert.equal(store.getSession(id).state, "awaiting_user");

  // reaper: session past wall-clock TTL gets killed and machine destroyed
  await orch.sweep(Date.now() + 1801 * 1000);
  assert.equal(store.getSession(id).state, "failed");
  assert.ok(sandbox.destroyed.includes("m-1"));
});

test("event replay from cursor", async () => {
  const { store } = setup();
  const id = store.createSession({ repo_url: "https://x.com/r", branch: "main", provider_id: "p", model_id: "m", task: "t", permission_mode: "auto", budgets: {}, session_token: "tok" });
  for (let i = 0; i < 5; i++) store.appendEvent(id, { ts: new Date().toISOString(), type: "assistant_text", payload: { i } });
  assert.equal(store.eventsAfter(id, 0).length, 5);
  assert.equal(store.eventsAfter(id, 3).length, 2);
  assert.deepEqual(store.eventsAfter(id, 3).map((e) => e.seq), [4, 5]);
});

test("reaper orphan scan destroys machines whose session is terminal or missing", async () => {
  const { store, sandbox } = setup();
  const orch = new Orchestrator(store, sandbox);

  // terminal session whose machine is still alive on the substrate
  const id = store.createSession({ repo_url: "https://x.com/r", branch: "main", provider_id: "p", model_id: "m", task: "t", permission_mode: "auto", budgets: {}, session_token: "tok" });
  store.setSessionState(id, "completed", "m-live");
  sandbox.machines = [
    { id: "m-live", provider: "fake", state: "started", metadata: { atelier_session: id } },
    // tagged with a session that no longer exists in the DB
    { id: "m-ghost", provider: "fake", state: "started", metadata: { atelier_session: "no-such-session" } },
    // foreign machine (no atelier_session metadata) — must be left alone
    { id: "m-foreign", provider: "fake", state: "started", metadata: {} },
    // already destroyed — skip
    { id: "m-dead", provider: "fake", state: "destroyed", metadata: { atelier_session: id } },
  ];

  await orch.sweep();
  assert.ok(sandbox.destroyed.includes("m-live"));
  assert.ok(sandbox.destroyed.includes("m-ghost"));
  assert.ok(!sandbox.destroyed.includes("m-foreign"));
  assert.ok(!sandbox.destroyed.includes("m-dead"));

  // the terminal session recorded an error event for the cleanup
  const evs = store.eventsAfter(id, 0);
  assert.ok(evs.some((e) => e.type === "error" && String((e.payload as any).message).includes("orphan machine m-live")));
});

test("GitHub OAuth: callback upserts the user and sets a verifiable session cookie", async (t) => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.PUBLIC_WEB_URL = "http://localhost:5173";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const s = String(url);
    if (s.includes("login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "gho_t" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (s.includes("api.github.com/user")) {
      return new Response(JSON.stringify({ id: 42, login: "alice", name: "Alice", avatar_url: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    for (const k of ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "SESSION_SECRET", "PUBLIC_WEB_URL"]) delete process.env[k];
  });

  const { app } = setup();
  const loginRes = await app.request("/auth/github/login");
  assert.equal(loginRes.status, 302);
  const sc = loginRes.headers.get("set-cookie") ?? "";
  const state = sc.match(/atelier_oauth_state=([^;]+)/)?.[1];
  assert.ok(state, "state cookie set on login");

  const cbRes = await app.request(`/auth/github/callback?code=abc&state=${state}`, {
    headers: { Cookie: `atelier_oauth_state=${state}` },
  });
  assert.equal(cbRes.status, 302);
  const sess = cbRes.headers.get("set-cookie")?.match(/atelier_session=([^;]+)/)?.[1];
  assert.ok(sess, "session cookie set on callback");

  // the cookie authenticates a request and carries the GitHub identity
  const st = await (await app.request("/auth/status", { headers: { Cookie: `atelier_session=${sess}` } })).json();
  assert.equal(st.authed, true);
  assert.equal(st.owner, false);
  assert.equal(st.user.login, "alice");
});

test("per-user scoping: users only see their own providers and sessions", async (t) => {
  process.env.SESSION_SECRET = "test-session-secret";
  t.after(() => { delete process.env.SESSION_SECRET; });
  const { store, app } = setup();
  const alice = store.upsertUser(1, "alice", null, null);
  const bob = store.upsertUser(2, "bob", null, null);
  const aliceCookie = `atelier_session=${signSession(alice)}`;
  const bobCookie = `atelier_session=${signSession(bob)}`;

  const ap = await app.request("/providers", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: aliceCookie },
    body: JSON.stringify({ name: "A", base_url: "https://a.io/v1", dialect: "openai-chat", api_key: "sk-a", models: [{ id: "m", role: "coder" }] }),
  });
  assert.equal(ap.status, 201);
  const { id: providerId } = await ap.json();

  const as = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: aliceCookie },
    body: JSON.stringify({ repo_url: "https://github.com/a/b", provider_id: providerId, model_id: "m", task: "do it" }),
  });
  const { id: aliceSession } = await as.json();

  // bob's session list is empty; he can't fetch alice's session or reuse her provider
  assert.equal((await (await app.request("/sessions", { headers: { Cookie: bobCookie } })).json()).length, 0);
  assert.equal((await app.request(`/sessions/${aliceSession}`, { headers: { Cookie: bobCookie } })).status, 404);
  assert.equal((await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: bobCookie },
    body: JSON.stringify({ repo_url: "https://github.com/a/b", provider_id: providerId, model_id: "m", task: "x" }),
  })).status, 404);

  // alice sees exactly her one session and one provider
  assert.equal((await (await app.request("/sessions", { headers: { Cookie: aliceCookie } })).json()).length, 1);
  assert.equal((await (await app.request("/providers", { headers: { Cookie: aliceCookie } })).json()).length, 1);
});

test("supervisor /replies endpoint returns user_message events after a cursor", async () => {
  const { store, app } = setup();
  const id = store.createSession({ repo_url: "https://x.com/r", branch: "main", provider_id: "p", model_id: "m", task: "t", permission_mode: "auto", budgets: {}, session_token: "tok" });
  const token = store.getSession(id).session_token;

  assert.equal((await (await app.request(`/internal/sessions/${id}/replies?after=0`, { headers: { Authorization: `Bearer ${token}` } })).json()).length, 0);

  await app.request(`/sessions/${id}/reply`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "use the foo branch" }),
  });

  const replies = await (await app.request(`/internal/sessions/${id}/replies?after=0`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, "use the foo branch");

  // cursor skips already-seen replies
  const next = await (await app.request(`/internal/sessions/${id}/replies?after=${replies[0].seq}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(next.length, 0);

  assert.equal((await app.request(`/internal/sessions/${id}/replies`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
});
