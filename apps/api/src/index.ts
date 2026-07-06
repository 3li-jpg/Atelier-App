import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Event, ProviderConfig, CreateSession } from "@atelier/schema";
import { FlyMachinesProvider } from "@atelier/sandbox";
import { Store, bus } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { encryptKey, redact } from "./secrets.ts";
import { validateProvider } from "./validate.ts";

export function buildApp(store: Store, orch: Orchestrator) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // ---- Providers (FR-1.x) ----
  app.post("/providers", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const apiKey: string = body.api_key;
    if (!apiKey) return c.json({ error: "api_key required" }, 400);
    const id = store.createProvider({ ...cfg, key_ciphertext: encryptKey(apiKey) });
    return c.json({ id }, 201);
  });

  app.get("/providers", (c) => c.json(store.listProviders()));

  app.post("/providers/validate", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const result = await validateProvider(cfg, body.api_key, cfg.models[0].id);
    return c.json(result, result.ok ? 200 : 422);
  });

  // ---- Sessions (FR-3.x) ----
  app.post("/sessions", async (c) => {
    const req = CreateSession.parse(await c.req.json());
    if (!store.getProvider(req.provider_id)) return c.json({ error: "unknown provider" }, 404);
    const id = store.createSession({ ...req, session_token: randomBytes(24).toString("hex") });
    orch.launch(id).catch(() => {}); // failure already recorded as events + failed state
    return c.json({ id, state: "created" }, 201);
  });

  app.get("/sessions", (c) => c.json(store.listSessions()));

  app.get("/sessions/:id", (c) => {
    const s = store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const { session_token, ...safe } = s;
    return c.json(safe);
  });

  app.post("/sessions/:id/cancel", async (c) => {
    await orch.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  // Event stream: replay after cursor, then live-tail. SSE (native to URLSession).
  app.get("/sessions/:id/stream", (c) => {
    const id = c.req.param("id");
    if (!store.getSession(id)) return c.json({ error: "not found" }, 404);
    const cursor = Number(c.req.query("cursor") ?? 0);
    return streamSSE(c, async (stream) => {
      for (const e of store.eventsAfter(id, cursor)) {
        await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
      }
      let open = true;
      const onEvent = (e: any) => { stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) }).catch(() => {}); };
      bus.on(`events:${id}`, onEvent);
      stream.onAbort(() => { open = false; bus.off(`events:${id}`, onEvent); });
      while (open) await new Promise((r) => setTimeout(r, 15_000)).then(() => stream.writeSSE({ event: "ping", data: "" }).catch(() => { open = false; }));
    });
  });

  // ---- Internal: supervisor event ingest (guide §2.5) ----
  app.post("/internal/sessions/:id/events", async (c) => {
    const id = c.req.param("id");
    const s = store.getSession(id);
    const auth = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${s?.session_token ?? ""}`;
    if (!s || auth.length !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const batch = (await c.req.json()) as unknown[];
    for (const raw of batch) {
      const e = Event.parse(raw);
      const payload = JSON.parse(redact(JSON.stringify(e.payload)));
      store.appendEvent(id, { ts: e.ts, type: e.type, payload });
      if (e.type === "state_change" && typeof payload.state === "string") {
        orch.onSupervisorState(id, payload.state);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("index.ts")) {
  const store = new Store();
  const sandbox = new FlyMachinesProvider(
    process.env.FLY_SANDBOX_APP ?? "atelier-sandboxes",
    process.env.FLY_SANDBOX_TOKEN ?? "",
  );
  const app = buildApp(store, new Orchestrator(store, sandbox));
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`atelier-api listening on :${port}`);
}
