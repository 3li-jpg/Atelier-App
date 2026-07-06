import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Event, ProviderConfig, CreateSession } from "@atelier/schema";
import { FlyMachinesProvider, LocalSandboxProvider } from "@atelier/sandbox";
import { Store, bus } from "./store.ts";
import { PgStore, type AnyStore } from "./pg-store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { encryptKey, redact } from "./secrets.ts";
import { validateProvider } from "./validate.ts";
import {
  signSession, verifySession, signWorkspaceToken, exchangeGithubCode, loginUrl, newState, isSecure,
  authConfigured, oauthEnabled, OWNER_ID, SESSION_COOKIE,
} from "./auth.ts";

const uidOf = (c: any): string | undefined => c.get("userId") as string | undefined;

export function buildApp(store: AnyStore, orch: Orchestrator) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // --- Auth (handoff T3): session cookie (GitHub OAuth) OR static bearer
  // AUTH_TOKEN (owner/admin backdoor) OR open when nothing is configured.
  // Only API data paths are guarded — /auth/*, /internal/* (supervisor
  // bearer), /health, and the static SPA bundle stay reachable so the
  // login page can load at all.
  const GUARDED = /^\/(sessions|providers|repos)(\/|$)/;
  app.use("*", async (c, next) => {
    if (!GUARDED.test(c.req.path)) return next();

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
  app.get("/auth/status", async (c) => {
    const uid = verifySession(getCookie(c, SESSION_COOKIE));
    const owner = uid === OWNER_ID;
    const user = uid ? (owner ? { login: "owner" } : await store.getUser(uid)) : null;
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
      const { user, token } = await exchangeGithubCode(code);
      const uid = await store.upsertUser(user.id, user.login, user.name, user.avatar_url);
      await store.storeUserToken(uid, token);
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

  // ---- Repos (FR: browse the user's own GitHub repos via their stored token) ----
  app.get("/repos", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const token = await store.getUserToken(uid);
    if (!token) return c.json({ error: "no github token" }, 401);
    const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "atelier" },
    });
    if (!res.ok) return c.json({ error: `github: ${res.status}` }, res.status);
    const repos = (await res.json()) as any[];
    return c.json(repos.map((r) => ({
      id: r.id, full_name: r.full_name, default_branch: r.default_branch, private: r.private,
    })));
  });

  app.get("/repos/:owner/:repo/branches", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const token = await store.getUserToken(uid);
    if (!token) return c.json({ error: "no github token" }, 401);
    const owner = decodeURIComponent(c.req.param("owner"));
    const repo = decodeURIComponent(c.req.param("repo"));
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "atelier" },
    });
    if (!res.ok) return c.json({ error: `github: ${res.status}` }, res.status);
    const branches = (await res.json()) as any[];
    return c.json(branches.map((b) => ({ name: b.name })));
  });

  // ---- Providers (FR-1.x) ----
  app.post("/providers", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const apiKey: string = body.api_key;
    if (!apiKey) return c.json({ error: "api_key required" }, 400);
    const id = await store.createProvider({ ...cfg, key_ciphertext: encryptKey(apiKey), user_id: uidOf(c) });
    return c.json({ id }, 201);
  });

  app.get("/providers", async (c) => c.json(await store.listProviders(uidOf(c))));

  app.post("/providers/validate", async (c) => {
    const body = await c.req.json();
    const cfg = ProviderConfig.parse(body);
    const result = await validateProvider(cfg, body.api_key, cfg.models[0].id);
    return c.json(result, result.ok ? 200 : 422);
  });

  // ---- Sessions (FR-3.x) ----
  app.post("/sessions", async (c) => {
    const req = CreateSession.parse(await c.req.json());
    const provider = await store.getProvider(req.provider_id);
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && provider.user_id && provider.user_id !== uid) {
      return c.json({ error: "unknown provider" }, 404); // don't leak cross-user existence
    }
    const id = await store.createSession({ ...req, session_token: randomBytes(24).toString("hex"), user_id: uid });
    orch.launch(id).catch(() => {}); // failure already recorded as events + failed state
    return c.json({ id, state: "created" }, 201);
  });

  app.get("/sessions", async (c) => c.json(await store.listSessions(uidOf(c))));

  app.get("/sessions/:id", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const { session_token, ...safe } = s;
    return c.json(safe);
  });

  app.post("/sessions/:id/cancel", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    await orch.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/sessions/:id/workspace", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    if (!s.machine_id) return c.json({ error: "no machine" }, 409);
    const wsUrl = process.env.WORKSPACES_URL;
    if (!wsUrl) return c.json({ error: "workspaces not configured" }, 503);
    const token = signWorkspaceToken(c.req.param("id"), uid ?? s.user_id ?? OWNER_ID);
    return c.redirect(`${wsUrl}/attach?token=${token}`, 302);
  });

  app.post("/sessions/:id/finish", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    await orch.finish(c.req.param("id"));
    return c.json({ ok: true });
  });

  // User answers a `question` event: record it and wake the machine if hibernated.
  // (Supervisor-side delivery of the message to the harness is handoff T7.2.)
  app.post("/sessions/:id/reply", async (c) => {
    const id = c.req.param("id");
    const s = await store.getSession(id);
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const { text } = await c.req.json();
    if (!text) return c.json({ error: "text required" }, 400);
    if (["completed", "failed", "cancelled"].includes(s.state)) return c.json({ error: "session ended" }, 409); // audit M5
    await store.appendEvent(id, { ts: new Date().toISOString(), type: "user_message", payload: { text } });
    await orch.wake(id);
    return c.json({ ok: true });
  });

  // Event stream: replay after cursor, then live-tail. SSE (native EventSource).
  app.get("/sessions/:id/stream", async (c) => {
    const id = c.req.param("id");
    const s = await store.getSession(id);
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const cursor = Number(c.req.query("cursor") ?? 0);
    return streamSSE(c, async (stream) => {
      for (const e of await store.eventsAfter(id, cursor)) {
        await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
      }
      let open = true;
      const onEvent = (e: any) => { stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) }).catch(() => { open = false; }); };
      bus.on(`events:${id}`, onEvent);
      stream.onAbort(() => { open = false; bus.off(`events:${id}`, onEvent); });
      // Shorter ping (audit L3): abort is detected within ~5s instead of 15s,
      // and a failed write flips `open` so the loop exits promptly.
      while (open) {
        await new Promise((r) => setTimeout(r, 5_000));
        if (!open) break;
        await stream.writeSSE({ event: "ping", data: "" }).catch(() => { open = false; });
      }
    });
  });

  // ---- Internal: supervisor endpoints (guide §2.5–2.6) ----
  const sessionAuth = async (c: any): Promise<any | null> => {
    const s = await store.getSession(c.req.param("id"));
    const auth = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${s?.session_token ?? ""}`;
    if (!s || auth.length !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return null;
    return s;
  };

  // Sealed-box config exchange: supervisor posts its X25519 pubkey, gets secrets back encrypted.
  app.post("/internal/sessions/:id/handshake", async (c) => {
    if (!(await sessionAuth(c))) return c.json({ error: "unauthorized" }, 401);
    const { pubkey } = await c.req.json();
    const raw = Buffer.from(String(pubkey ?? ""), "base64");
    if (raw.length !== 32) return c.json({ error: "pubkey must be 32 bytes base64" }, 400);
    return c.json(await orch.handshake(c.req.param("id"), raw));
  });

  app.post("/internal/sessions/:id/events", async (c) => {
    const id = c.req.param("id");
    if (!(await sessionAuth(c))) return c.json({ error: "unauthorized" }, 401);
    const batch = (await c.req.json()) as unknown[];
    for (const raw of batch) {
      const e = Event.parse(raw);
      const payload = JSON.parse(redact(JSON.stringify(e.payload)));
      await store.appendEvent(id, { ts: e.ts, type: e.type, payload });
      if (e.type === "state_change" && typeof payload.state === "string") {
        await orch.onSupervisorState(id, payload.state);
      }
    }
    await orch.activity(id);
    return c.json({ ok: true });
  });

  // Supervisor reads user replies (user_message events) to relay into the agent.
  // ponytail: simple long-poll (1 s) — fine for one user; switch to a notify
  // endpoint or websocket if latency matters at scale.
  app.get("/internal/sessions/:id/replies", async (c) => {
    if (!(await sessionAuth(c))) return c.json({ error: "unauthorized" }, 401);
    const after = Number(c.req.query("after") ?? 0);
    const replies = (await store.eventsAfter(c.req.param("id"), after))
      .filter((e) => e.type === "user_message")
      .map((e) => ({ seq: e.seq, text: (e.payload as Record<string, unknown>).text, ts: e.ts }));
    return c.json(replies);
  });

  const proxyAuth = (c: any) => {
    const t = process.env.PROXY_TOKEN;
    return Boolean(t && c.req.header("Authorization") === `Bearer ${t}`);
  };

  app.get("/internal/workspace/:id", async (c) => {
    if (!proxyAuth(c)) return c.json({ error: "unauthorized" }, 401);
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    return c.json({ machine_id: s.machine_id ?? null, state: s.state });
  });

  app.post("/internal/workspace/:id/wake", async (c) => {
    if (!proxyAuth(c)) return c.json({ error: "unauthorized" }, 401);
    await orch.wake(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/internal/workspace/:id/activity", async (c) => {
    if (!proxyAuth(c)) return c.json({ error: "unauthorized" }, 401);
    await orch.activity(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ---- Static SPA (handoff T6: one deploy — Hono serves the web bundle) ----
  const webDist = process.env.WEB_DIST;
  if (webDist) {
    app.use("*", serveStatic({ root: webDist }));
    app.get("*", serveStatic({ root: webDist, path: "index.html" }));
  }

  return app;
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("index.ts")) {
  // DATABASE_URL (Supabase or any Postgres) → PgStore; otherwise sqlite on disk.
  const store = process.env.DATABASE_URL
    ? await new PgStore(process.env.DATABASE_URL).init()
    : new Store();
  const sandbox = process.env.SANDBOX === "local"
    ? new LocalSandboxProvider()
    : new FlyMachinesProvider(
        process.env.FLY_SANDBOX_APP ?? "atelier-sandboxes",
        process.env.FLY_SANDBOX_TOKEN ?? "",
      );
  if (process.env.SANDBOX !== "local" && !process.env.FLY_SANDBOX_TOKEN) {
    console.warn("WARNING: FLY_SANDBOX_TOKEN is not set — every session will fail at provisioning with a Fly 401. Set it (see .env.example) or run with SANDBOX=local.");
  }
  const orch = new Orchestrator(store, sandbox);
  orch.startReaper();
  const app = buildApp(store, orch);
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`atelier-api listening on :${port}`);
}
