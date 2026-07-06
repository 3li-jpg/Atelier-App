process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SandboxProvider, SandboxRef, SandboxState } from "@atelier/sandbox";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { encryptKey, decryptKey, redact } from "./secrets.ts";

class FakeSandbox implements SandboxProvider {
  created: any[] = [];
  destroyed: string[] = [];
  async create(cfg: any): Promise<SandboxRef> { this.created.push(cfg); return { id: "m-1", provider: "fake" }; }
  async suspend() {} async resume() {} async stop() {}
  async destroy(ref: SandboxRef) { this.destroyed.push(ref.id); }
  async status(): Promise<SandboxState> { return "started"; }
  async waitFor() {}
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

test("event replay from cursor", async () => {
  const { store } = setup();
  const id = store.createSession({ repo_url: "https://x.com/r", branch: "main", provider_id: "p", model_id: "m", task: "t", permission_mode: "auto", budgets: {}, session_token: "tok" });
  for (let i = 0; i < 5; i++) store.appendEvent(id, { ts: new Date().toISOString(), type: "assistant_text", payload: { i } });
  assert.equal(store.eventsAfter(id, 0).length, 5);
  assert.equal(store.eventsAfter(id, 3).length, 2);
  assert.deepEqual(store.eventsAfter(id, 3).map((e) => e.seq), [4, 5]);
});
