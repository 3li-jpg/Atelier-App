import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Event, ProviderConfig, CreateSession } from "@atelier/schema";
import { FlyMachinesProvider } from "@atelier/sandbox";
import { Store, bus } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { encryptKey, redact } from "./secrets.ts";
import { validateProvider } from "./validate.ts";
import {
  signSession, verifySession, exchangeGithubCode, loginUrl, newState, isSecure,
  authConfigured, oauthEnabled, OWNER_ID, SESSION_COOKIE,
} from "./auth.ts";

const uidOf = (c: any): string | undefined => c.get("userId") as string | undefined;

export function buildApp(store: Store, orch: Orchestrator) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // --- Auth (handoff T3): session cookie (GitHub OAuth) OR static bearer
  // AUTH_TOKEN (owner/admin backdoor) OR open when nothing is configured.
  // /health, /auth/*, and /internal/* (supervisor bearer) are exempt.
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (p === "/health" || p.startsWith("/auth/") || p.startsWith("/internal/")) return next();

    const uid = verifySession(getCookie(c, SESSION_COOKIE));
    if (uid) { c.set("userId", uid); return next(); }

    const tok = process.env.AUTH_TOKEN;
    if (tok) {
      const auth = c.req.header("Authorization") ?? "";
      const expected = `Bearer ${tok}`;
      if (auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
        c.set("userId", OWNER_ID);
        return next();
      }
    }

    if (authConfigured()) return c.json({ error: "unauthorized" }, 401);
    return next(); // open: dev / owner-alpha with no auth configured
  });

  // ---- Auth routes ----
  app.get("/auth/status", (c) => {
    const uid = verifySession(getCookie(c, SESSION_COOKIE));
    const owner = uid === OWNER_ID;
    const user = uid ? (owner ? { login: "owner" } : store.getUser(uid)) : null;
    return c.json({ oauth: oauthEnabled(), authed: Boolean(uid), owner, user });
  });

  app.get("/auth/github/login", (c) => {
    if (!oauthEnabled()) return c.json({ error: "oauth not configured" }, 503);
    const state = newState();
    setCookie(c, "atelier_oauth_state", state, { httpOnly: true, sameSite: "Lax", maxAge: 600, path: "/" });
    return c.redirect(loginUrl(state), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    if (!oauthEnabled()) return c.json({ error: "oauth not configured" }, 503);
    const code = c.req.query("code");
    const state = c.req.query("state");
    const cookieState = getCookie(c, "atelier_oauth_state");
    if (!code || !state || !cookieState || state !== cookieState) {
      return c.json({ error: "invalid state" }, 400);
    }
    deleteCookie(c, "atelier_oauth_state", { path: "/" });
    try {
      const { user } = await exchangeGithubCode(code);
      const uid = store.upsertUser(user.id, user.login, user.name, user.avatar_url);
      setCookie(c, SESSION_COOKIE, signSession(uid), {
        httpOnly: true, sameSite: "Lax", secure: isSecure(), maxAge: 60 * 60 * 24 * 7, path: "/",
      });
    } catch (e) {
      const base = (process.env.PUBLIC_WEB_URL ?? "/").replace(/\/$/, "");
      return c.redirect(`${base}/?auth_error=${encodeURIComponent(String(e))}`, 302);
    }
    const base = (process.env.PUBLIC_WEB_URL ?? "/").replace(/\/$/, "");
    return c.redirect(base + "/", 302);
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ---- Providers (FR-1.x) ----
  app.post("/providers", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const apiKey: string = body.api_key;
    if (!apiKey) return c.json({ error: "api_key required" }, 400);
    const id = store.createProvider({ ...cfg, key_ciphertext: encryptKey(apiKey), user_id: uidOf(c) });
    return c.json({ id }, 201);
  });

  app.get("/providers", (c) => c.json(store.listProviders(uidOf(c))));

  app.post("/providers/validate", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const result = await validateProvider(cfg, body.api_key, cfg.models[0].id);
    return c.json(result, result.ok ? 200 : 422);
  });

  // ---- Sessions (FR-3.x) ----
  app.post("/sessions", async (c) => {
    const req = CreateSession.parse(await c.req.json());
    const provider = store.getProvider(req.provider_id);
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && provider.user_id && provider.user_id !== uid) {
      return c.json({ error: "unknown provider" }, 404); // don't leak cross-user existence
    }
    const id = store.createSession({ ...req, session_token: randomBytes(24).toString("hex"), user_id: uid });
    orch.launch(id).catch(() => {}); // failure already recorded as events + failed state
    return c.json({ id, state: "created" }, 201);
  });

  app.get("/sessions", (c) => c.json(store.listSessions(uidOf(c))));

  app.get("/sessions/:id", (c) => {
    const s = store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const { session_token, ...safe } = s;
    return c.json(safe);
  });

  app.post("/sessions/:id/cancel", async (c) => {
    const s = store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    await orch.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  // User answers a `question` event: record it and wake the machine if hibernated.
  // (Supervisor-side delivery of the message to the harness is handoff T7.2.)
  app.post("/sessions/:id/reply", async (c) => {
    const id = c.req.param("id");
    const s = store.getSession(id);
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const { text } = await c.req.json();
    if (!text) return c.json({ error: "text required" }, 400);
    store.appendEvent(id, { ts: new Date().toISOString(), type: "user_message", payload: { text } });
    await orch.wake(id);
    return c.json({ ok: true });
  });

  // Event stream: replay after cursor, then live-tail. SSE (native EventSource).
  app.get("/sessions/:id/stream", (c) => {
    const id = c.req.param("id");
    const s = store.getSession(id);
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
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

  // ---- Internal: supervisor endpoints (guide §2.5–2.6) ----
  const sessionAuth = (c: any): any | null => {
    const s = store.getSession(c.req.param("id"));
    const auth = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${s?.session_token ?? ""}`;
    if (!s || auth.length !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return null;
    return s;
  };

  // Sealed-box config exchange: supervisor posts its X25519 pubkey, gets secrets back encrypted.
  app.post("/internal/sessions/:id/handshake", async (c) => {
    if (!sessionAuth(c)) return c.json({ error: "unauthorized" }, 401);
    const { pubkey } = await c.req.json();
    const raw = Buffer.from(String(pubkey ?? ""), "base64");
    if (raw.length !== 32) return c.json({ error: "pubkey must be 32 bytes base64" }, 400);
    return c.json(orch.handshake(c.req.param("id"), raw));
  });

  app.post("/internal/sessions/:id/events", async (c) => {
    const id = c.req.param("id");
    if (!sessionAuth(c)) return c.json({ error: "unauthorized" }, 401);
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
  const orch = new Orchestrator(store, sandbox);
  orch.startReaper();
  const app = buildApp(store, orch);
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`atelier-api listening on :${port}`);
}
