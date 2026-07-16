import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, normalize } from "node:path";
import { Event, ProviderConfig, CreateSession, UpdateSession, Dialect } from "@atelier/schema";
import { z } from "zod";
import { FlyMachinesProvider, LocalSandboxProvider, DaytonaProvider, E2BProvider, type SandboxProvider } from "@atelier/sandbox";
import { Store, bus } from "./store.ts";
import { PgStore, type AnyStore } from "./pg-store.ts";
import { Orchestrator, StaleProviderKeyError } from "./orchestrator.ts";
import { encryptKey, redact } from "./secrets.ts";
import { validateProvider } from "./validate.ts";
import {
  signSession, verifySession, signWorkspaceToken, exchangeGithubCode, loginUrl, newState, isSecure,
  authConfigured, oauthEnabled, OWNER_ID, SESSION_COOKIE, hashPassword, verifyPassword,
} from "./auth.ts";
import { supabaseAdmin } from "./supabase.ts";
import { createCheckoutSession, createBillingPortalSession, handleWebhook } from "./billing.ts";

const uidOf = (c: any): string | undefined => c.get("userId") as string | undefined;

// Verify a Supabase JWT access token and return the user's UUID.
// Uses the supabaseAdmin client to getUser() — validates the JWT signature
// against Supabase's JWKS and returns the user record.
async function verifySupabaseToken(token: string): Promise<string | null> {
  const admin = supabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export function buildApp(store: AnyStore, orch: Orchestrator) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // --- Auth (handoff T3): session cookie (GitHub OAuth) OR static bearer
  // AUTH_TOKEN (owner/admin backdoor) OR open when nothing is configured.
  // Only API data paths are guarded — /auth/*, /internal/* (supervisor
  // bearer), /health, and the static SPA bundle stay reachable so the
  // login page can load at all.
  const GUARDED = /^\/(sessions|providers|repos|account|billing)(\/|$)/;
  app.use("*", async (c, next) => {
    if (!GUARDED.test(c.req.path)) return next();

    const uid = verifySession(getCookie(c, SESSION_COOKIE));
    if (uid) { c.set("userId", uid); return next(); }
    // Static AUTH_TOKEN via cookie: the embedded opencode iframe can't send a
    // Bearer header, so the opencode proxy mints a scoped atelier_session
    // cookie holding the static owner token. Honor it here (owner backdoor).
    const staticTok = process.env.AUTH_TOKEN;
    if (staticTok && getCookie(c, SESSION_COOKIE) === staticTok) {
      c.set("userId", OWNER_ID);
      return next();
    }

    // Also accept the session token as a Bearer header (cross-origin: landing
    // page on :3001 passes the token to the PWA on :5173 via URL hash; the
    // PWA stores it and sends it as Authorization: Bearer <token>).
    // Also accepts Supabase JWT access tokens.
    const authHeader = c.req.header("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      // First check if it's the static AUTH_TOKEN
      const staticTok = process.env.AUTH_TOKEN;
      if (staticTok && bearerToken === staticTok) {
        c.set("userId", OWNER_ID);
        return next();
      }
      // Then check if it's a signed session token (custom auth)
      const sessionUid = verifySession(bearerToken);
      if (sessionUid) {
        c.set("userId", sessionUid);
        return next();
      }
      // Finally, check if it's a Supabase JWT access token
      const supabaseUid = await verifySupabaseToken(bearerToken);
      if (supabaseUid) {
        c.set("userId", supabaseUid);
        return next();
      }
    }

    // EventSource (SSE) cannot send Authorization headers, so accept the token
    // as a query parameter for the stream endpoint.
    const queryToken = c.req.query("token");
    if (queryToken) {
      const staticTok = process.env.AUTH_TOKEN;
      if (staticTok && queryToken === staticTok) {
        c.set("userId", OWNER_ID);
        return next();
      }
      const sessionUid = verifySession(queryToken);
      if (sessionUid) {
        c.set("userId", sessionUid);
        return next();
      }
      const supabaseUid = await verifySupabaseToken(queryToken);
      if (supabaseUid) {
        c.set("userId", supabaseUid);
        return next();
      }
    }

    if (authConfigured()) return c.json({ error: "unauthorized" }, 401);
    return next(); // open: dev / owner-alpha with no auth configured
  });

  // ---- Auth routes ----
  app.get("/auth/status", async (c) => {
    let uid = verifySession(getCookie(c, SESSION_COOKIE)) ?? undefined;
    // Also check bearer token (Supabase JWT or custom session token)
    if (!uid) {
      const auth = c.req.header("Authorization") ?? "";
      if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        // Static AUTH_TOKEN owner backdoor — the guarded routes accept it (above),
        // but /auth/status must too, else the web UI gates on login even though
        // every data call succeeds with the bearer (owner-alpha CLI flow).
        const staticTok = process.env.AUTH_TOKEN;
        if (staticTok && token === staticTok) {
          uid = OWNER_ID;
        } else {
          uid = verifySession(token) ?? undefined;
          if (!uid) {
            uid = (await verifySupabaseToken(token)) ?? undefined;
          }
        }
      }
    }
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

  // ---- Email/password auth ----
  app.post("/auth/signup", async (c) => {
    const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return c.json({ error: "email and password required" }, 400);
    if (!/^.+@.+\..+$/.test(body.email)) return c.json({ error: "invalid email" }, 400);
    if (body.password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
    const existing = await store.getEmailUser(body.email);
    if (existing) return c.json({ error: "email already registered" }, 409);
    const uid = await store.createEmailUser(body.email, hashPassword(body.password));
    const sessionToken = signSession(uid);
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true, sameSite: "Lax", secure: isSecure(), maxAge: 60 * 60 * 24 * 7, path: "/",
    });
    return c.json({ ok: true, user: { login: body.email }, session_token: sessionToken });
  });

  app.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return c.json({ error: "email and password required" }, 400);
    const user = await store.getEmailUser(body.email);
    if (!user || !user.password_hash) return c.json({ error: "invalid credentials" }, 401);
    if (!verifyPassword(body.password, user.password_hash)) return c.json({ error: "invalid credentials" }, 401);
    const sessionToken = signSession(user.id);
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true, sameSite: "Lax", secure: isSecure(), maxAge: 60 * 60 * 24 * 7, path: "/",
    });
    return c.json({ ok: true, user: { login: body.email }, session_token: sessionToken });
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

  app.patch("/providers/:id", async (c) => {
    const uid = uidOf(c);
    const existing = await store.getProvider(c.req.param("id"));
    if (!existing) return c.json({ error: "not found" }, 404);
    if (uid !== undefined && existing.user_id && existing.user_id !== uid) {
      return c.json({ error: "not found" }, 404); // don't leak cross-user existence
    }
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid json" }, 400);
    // Validate each present field with the same zod shapes as create.
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const v = z.string().min(1).safeParse(body.name); if (!v.success) return c.json({ error: "invalid name" }, 400); patch.name = v.data;
    }
    if (body.base_url !== undefined) {
      const v = z.string().url().safeParse(body.base_url); if (!v.success) return c.json({ error: "invalid base_url" }, 400); patch.base_url = v.data;
    }
    if (body.dialect !== undefined) {
      const v = Dialect.safeParse(body.dialect); if (!v.success) return c.json({ error: "invalid dialect" }, 400); patch.dialect = v.data;
    }
    if (body.models !== undefined) {
      // full replace — same shape as create
      const v = z.array(z.object({ id: z.string(), role: z.enum(["coder","utility"]), context: z.number().int().positive().optional(), tool_calls: z.boolean().default(true) })).min(1).safeParse(body.models);
      if (!v.success) return c.json({ error: "invalid models" }, 400); patch.models = v.data;
    }
    if (body.headers !== undefined) {
      const v = z.record(z.string()).safeParse(body.headers); if (!v.success) return c.json({ error: "invalid headers" }, 400); patch.headers = v.data;
    }
    if (body.quirks !== undefined) {
      const v = z.record(z.unknown()).safeParse(body.quirks); if (!v.success) return c.json({ error: "invalid quirks" }, 400); patch.quirks = v.data;
    }
    if (body.api_key !== undefined) {
      if (typeof body.api_key !== "string" || !body.api_key) return c.json({ error: "invalid api_key" }, 400);
      patch.key_ciphertext = encryptKey(body.api_key);
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "no fields to update" }, 400);
    await store.updateProvider({ id: c.req.param("id"), ...patch });
    return c.json({ ok: true });
  });

  app.delete("/providers/:id", async (c) => {
    const uid = uidOf(c);
    const existing = await store.getProvider(c.req.param("id"));
    if (!existing) return c.json({ error: "not found" }, 404);
    if (uid !== undefined && existing.user_id && existing.user_id !== uid) {
      return c.json({ error: "not found" }, 404);
    }
    await store.deleteProvider(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ---- Sessions (FR-3.x) ----
  app.post("/sessions", async (c) => {
    const parsed = CreateSession.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid session", issues: parsed.error.issues }, 400);
    const req = parsed.data;
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

  // Live autonomy toggle (landing: "flip on autopilot"). Persists the new mode;
  // the next handshake re-seals config so the runner applies the permission
  // policy. Emits an event so the UI reflects the change over SSE.
  app.patch("/sessions/:id", async (c) => {
    const parsed = UpdateSession.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid update", issues: parsed.success ? [] : parsed.error.issues }, 400);
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    await store.setPermissionMode(c.req.param("id"), parsed.data.permission_mode);
    await store.appendEvent(c.req.param("id"), {
      ts: new Date().toISOString(), type: "state_change",
      payload: { permission_mode: parsed.data.permission_mode },
    });
    return c.json({ ok: true, permission_mode: parsed.data.permission_mode });
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

  // Browser preview: serve the agent's working repo as static files so the UI
  // can render changes in an iframe (landing: "open it and test on localhost").
  // Local mode only — the repo lives at /tmp/atelier/<id8>/repo. Path is
  // confined to the repo root (no traversal). SPA fallback → index.html.
  app.get("/sessions/:id/preview/*", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const root = process.env.RUNNER_WORKSPACE ?? "/tmp/atelier";
    const repoDir = resolvePath(root, `${c.req.param("id").slice(0, 8)}/repo`);
    if (!existsSync(repoDir)) return c.json({ error: "no preview — workspace not ready" }, 409);
    // Confine the requested path under repoDir (defeat ../ traversal).
    const rel = normalize(c.req.param("*") ?? "");
    const abs = resolvePath(repoDir, rel);
    if (!abs.startsWith(repoDir + "/") && abs !== repoDir) return c.json({ error: "forbidden" }, 403);
    const tryFile = (p: string): { path: string; mime: string } | null => {
      if (!existsSync(p) || !statSync(p).isFile()) return null;
      return { path: p, mime: mimeFor(p) };
    };
    const hit = tryFile(abs) ?? tryFile(join(abs, "index.html")) ?? tryFile(join(repoDir, "index.html"));
    if (!hit) return c.json({ error: "no index.html to preview" }, 404);
    return c.body(readFileSync(hit.path), 200, { "Content-Type": hit.mime, "Cache-Control": "no-store" });
  });

  // opencode web UI proxy: forward /sessions/:id/opencode/* → the session's
  // opencode web server (127.0.0.1:<port>). The supervisor writes port+password
  // to <workspace>/opencode.web on launch. Streams both ways so SSE (/event) and
  // large POST bodies pass through unbuffered. Basic auth injected from the
  // discovery file — the client never sees the opencode password.
  app.all("/sessions/:id/opencode/*", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    const webFile = join(process.env.RUNNER_WORKSPACE ?? "/tmp/atelier", `${c.req.param("id").slice(0, 8)}/opencode.web`);
    if (!existsSync(webFile)) return c.json({ error: "workspace not ready" }, 409);
    const [port, password] = readFileSync(webFile, "utf8").trim().split("\n");
    if (!port || !password) return c.json({ error: "workspace not ready" }, 409);
    // The iframe can't send an Authorization header, so the global middleware
    // authenticates the first (HTML) request via ?token= in the URL. On that
    // first hit, mint a session cookie scoped to this opencode prefix so the
    // SPA's subsequent same-prefix fetches (rewritten by the boot script) stay
    // authenticated without the query param.
    const qTok = c.req.query("token");
    if (qTok) {
      // Accept the static AUTH_TOKEN or a signed session token — same set the
      // global middleware honors. Mint a scoped cookie so the iframe's later
      // same-prefix fetches stay authed without the query param.
      const staticTok = process.env.AUTH_TOKEN;
      const ok = (staticTok && qTok === staticTok) || !!verifySession(qTok);
      if (ok) setCookie(c, SESSION_COOKIE, qTok, { httpOnly: true, sameSite: "Lax", path: `/sessions/${c.req.param("id")}/opencode`, maxAge: 86400 });
    }
    // Hono's c.req.param("*") returns "" here (the * wildcard after a :id param
    // doesn't populate reliably in @hono/node-server). Slice the sub-path straight
    // off c.req.path: everything after "/opencode/".
    const marker = `/sessions/${c.req.param("id")}/opencode/`;
    const sub = c.req.path.startsWith(marker) ? c.req.path.slice(marker.length) : "";
    // ponytail: opencode's root path (/) is a project/session picker. The Atelier
    // session maps to exactly one workspace, so redirect root to the opencode web
    // SPA's canonical route: /<base64url(directory)>/session. A slug route (e.g.
    // /neon-knight/) causes the SPA to base64-decode the slug as a directory suffix,
    // which produces a garbled directory and breaks API calls like /api/reference.
    if (sub === "" && (c.req.method === "GET" || c.req.method === "HEAD")) {
      const pathRes = await fetch(`http://127.0.0.1:${port}/path`, {
        headers: { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64"), accept: "application/json" },
      }).catch(() => null);
      if (pathRes?.ok) {
        const pathInfo = await pathRes.json().catch(() => null);
        const dir = pathInfo?.directory;
        if (typeof dir === "string") {
          const b64 = Buffer.from(dir, "utf8").toString("base64url").replace(/=+$/, "");
          // The bridge creates an opencode session named after the Atelier session.
          // Open the UI on that exact session so user messages and model replies
          // share the same opencode session that the bridge is already consuming.
          const expectedTitle = `atelier-${c.req.param("id")}`;
          const sessionsRes = await fetch(`http://127.0.0.1:${port}/session?directory=${encodeURIComponent(dir)}&roots=true&limit=55`, {
            headers: { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64"), accept: "application/json" },
          }).catch(() => null);
          if (sessionsRes?.ok) {
            const sessions = (await sessionsRes.json().catch(() => [])) as any[];
            const match = sessions.find((s) => s.title === expectedTitle || s.id === expectedTitle);
            if (match?.id) return c.redirect(`./${b64}/session/${match.id}`);
          }
          return c.redirect(`./${b64}/session`);
        }
      }
    }
    // Strip our `token` query param before forwarding — opencode doesn't know it.
    const qs = c.req.url.split("?")[1] ?? "";
    const cleanQs = qs.split("&").filter((p) => p && !p.startsWith("token=")).join("&");
    const url = `http://127.0.0.1:${port}/${sub}${cleanQs ? "?" + cleanQs : ""}`;
    // Forward only content-relevant headers. opencode web does content
    // negotiation on Accept; forwarding the browser's text/html Accept for API
    // routes would return the SPA. Pass through Accept + Content-Type only.
    const fwdHeaders: Record<string, string> = {
      authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64"),
    };
    const accept = c.req.raw.headers.get("accept");
    if (accept) fwdHeaders.accept = accept;
    const ctype = c.req.raw.headers.get("content-type");
    if (ctype) fwdHeaders["content-type"] = ctype;
    const hasBody = !["GET", "HEAD"].includes(c.req.method);
    const upstream = await fetch(url, {
      method: c.req.method,
      headers: fwdHeaders,
      body: hasBody ? c.req.raw.body : undefined,
      // @ts-expect-error duplex:"half" is required by undici when streaming a request body
      ...(hasBody ? { duplex: "half" } : {}),
    }).catch((e) => { throw new Error(`opencode proxy: ${e.message}`); });
    // Drop hop-by-hop + host headers from the upstream response: the proxy is
    // a fresh hop, so transfer-encoding/content-length/connection must not be
    // copied verbatim (the node-server sets its own). Also drop the CSP header:
    // opencode's strict CSP forbids inline scripts, but we inject a boot script
    // into the HTML to rewrite the SPA's root-relative API calls under the proxy
    // prefix. Keeping CSP would block that boot script → blank iframe.
    // ponytail: drop content-encoding too — undici's fetch() auto-decompresses
    // the body, so forwarding the original gzip header makes the browser try to
    // gunzip plaintext → ERR_CONTENT_DECODING_FAILED. content-length goes since
    // the decoded length differs.
    const drop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding", "content-security-policy", "content-security-policy-report-only", "x-frame-options"]);
    const respHeaders: Record<string, string> = {};
    upstream.headers.forEach((v, k) => { if (!drop.has(k.toLowerCase())) respHeaders[k] = v; });
    // The opencode SPA hardcodes API calls against location.origin with
    // root-relative paths (/event, /session, /config, …). Embedded at
    // /sessions/:id/opencode/, those would miss the proxy. Inject a <base> for
    // asset URLs AND a boot script that rewrites fetch/EventSource/XHR to prefix
    // opencode API roots with the session's proxy path. Apply this to any HTML
    // response (root slug redirect or session slug page); assets + SSE stream
    // through untouched.
    const prefix = `/sessions/${c.req.param("id")}/opencode`;
    // Root-absolute static-asset prefixes used by opencode. <base href> does NOT
    // rebase paths that start with "/", so we rewrite these explicitly in both
    // HTML and CSS responses.
    const ASSET_PREFIXES = ["/assets/", "/favicon", "/site.webmanifest", "/apple-touch-icon", "/social-share", "/opencode-"];
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const html = await upstream.text();
      let rewritten = html.replace(/((?:src|href)\s*=\s*")\/([^"]*)"/g, (m, attr, rest) => {
        if (ASSET_PREFIXES.some((p) => ("/" + rest).startsWith(p))) return `${attr}${prefix}/${rest}"`;
        return m;
      });
      // opencode's browser-router SPA reads window.location.pathname directly.
      // The proxy prefix makes it see /sessions/.../opencode/<base64dir>/session.
      // Mask that prefix so the SPA sees its own canonical route (e.g.
      // /L3By.../session) before the bundle parses the route. Same-origin, no
      // reload; the base tag still anchors relative assets to the proxy prefix.
      const base = `<base href="${prefix}/">`;
      const routePath = sub ? `/${sub}` : prefix;
      const routeMask = `<script>(function(){try{history.replaceState(null,"",${JSON.stringify(routePath)});}catch(e){}})();</script>`;
      // ponytail: opencode web has a multi-server feature — it persists an active
      // server URL in localStorage ("opencode.settings.dat:defaultServerUrl") and
      // reads it via YQ() as the API base, overriding location.origin. Embedded in
      // Atelier there is exactly ONE server (this proxy at location.origin), so any
      // persisted entry (e.g. a raw http://127.0.0.1:<port> from earlier direct
      // access) makes the SPA connect to opencode's real address, which needs Basic
      // auth the browser can't supply → opencode's "add server" login dialog. Clear
      // both keys before the bundle loads so it always falls back to location.origin.
      const serverReset = `<script>(function(){try{localStorage.removeItem("opencode.settings.dat:defaultServerUrl");localStorage.removeItem("app.server.otherServers");}catch(e){}})();</script>`;
      // opencode API path roots — matched at the START of the URL so app routes
      // like /sessions (plural) are never rewritten, only opencode's own roots.
      // ponytail: monkey-patch fetch/EventSource/XHR so opencode's SPA — which
      // builds absolute URLs from location.origin (e.g. http://host/global/config)
      // — hits our proxy prefix instead of escaping to the parent origin (Vite's
      // SPA fallback returns HTML, breaking the app). pre() strips the origin so
      // both "/global/config" and "http://host/global/config" map to prefix+path.
      const boot = `<script>(function(){var P="${prefix}";var ROOTS=["/event","/session","/message","/config","/agent","/provider","/command","/file","/find","/formatter","/log","/lsp","/mcp","/path","/permission","/project","/pty","/question","/skill","/vcs","/global","/api","/experimental"];function path(u){if(typeof u!=="string")return u;var i=u.indexOf("://");if(i>0){var s=u.indexOf("/",i+3);return s<0?"":"/"+u.slice(s+1);}return u;}function pre(u){u=path(u);for(var i=0;i<ROOTS.length;i++){var r=ROOTS[i];if(u===r||u.indexOf(r+"/")===0||u.indexOf(r+"?")===0||u.indexOf(r+"#")===0)return P+u;}return u;}var of=window.fetch;window.fetch=function(i,o){var url=typeof i==="string"?i:(i&&i.url);var init=typeof i==="string"?o:i;function send(body){var cfg={};if(init){var keys=["method","headers","body","mode","credentials","cache","redirect","referrer","referrerPolicy","integrity","keepalive","signal"];for(var k=0;k<keys.length;k++){var key=keys[k];if(init[key]!==undefined)cfg[key]=init[key];}if(body!==undefined)cfg.body=body;delete cfg.duplex;}return of.call(window,new Request(pre(url),cfg));}if(init&&init.body instanceof ReadableStream){return new Response(init.body).arrayBuffer().then(function(buf){return send(buf);});}return send();};var OE=window.EventSource;window.EventSource=function(u,c){return new OE(pre(u),c);};var oo=window.XMLHttpRequest.prototype.open;window.XMLHttpRequest.prototype.open=function(m,u){return oo.call(this,m,pre(u));};})();</script>`;
      rewritten = rewritten.replace("<head>", `<head>${base}${routeMask}${serverReset}${boot}`);
      respHeaders["content-type"] = "text/html; charset=utf-8";
      return c.body(rewritten, upstream.status as any, respHeaders);
    }
    if (contentType.includes("text/css")) {
      const css = await upstream.text();
      const rewrittenCss = css.replace(/url\(\s*["']?\/([^"')\s]+)["']?\s*\)/g, (m, rest) => {
        if (ASSET_PREFIXES.some((p) => ("/" + rest).startsWith(p))) return `url(${prefix}/${rest})`;
        return m;
      });
      respHeaders["content-type"] = "text/css; charset=utf-8";
      return c.body(rewrittenCss, upstream.status as any, respHeaders);
    }
    if (contentType.includes("javascript")) {
      const js = await upstream.text();
      // ponytail: opencode's bundle references its static assets with root-absolute
      // /assets/ URLs. The boot script can only rewrite JS fetch/XHR; elements like
      // SVG <use href="/assets/sprite-..."> are loaded by the browser, so we prefix
      // all /assets/ strings in the bundle itself. This is safe for the generated
      // bundle because every /assets/ occurrence is an asset path.
      const rewrittenJs = js.replace(/\/(assets\/)/g, `${prefix}/$1`);
      respHeaders["content-type"] = "text/javascript; charset=utf-8";
      return c.body(rewrittenJs, upstream.status as any, respHeaders);
    }
    return c.body(upstream.body, upstream.status as any, respHeaders);
  });

  app.post("/sessions/:id/finish", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    await orch.finish(c.req.param("id"));
    return c.json({ ok: true });
  });

  // Delete a terminal workspace (row + events). Active sessions must be
  // finished/cancelled first — never hard-deleted out from under a running sandbox.
  app.delete("/sessions/:id", async (c) => {
    const s = await store.getSession(c.req.param("id"));
    if (!s) return c.json({ error: "not found" }, 404);
    const uid = uidOf(c);
    if (uid !== undefined && s.user_id && s.user_id !== uid) return c.json({ error: "not found" }, 404);
    if (!["completed", "failed", "cancelled"].includes(s.state)) {
      return c.json({ error: "session is active" }, 409);
    }
    await store.deleteSession(c.req.param("id"));
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

  // ---- Account ----
  app.get("/account", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const row = await store.getAccount(uid);
    if (!row) return c.json({ error: "not found" }, 404);
    const githubConnected = Boolean(row.github_token_ciphertext);
    return c.json({
      user: {
        id: row.id, login: row.login, name: row.name, avatar_url: row.avatar_url,
        github_connected: githubConnected,
      },
      plan: { id: row.plan ?? "free", name: "Free", byok: true, compute: "byoc" },
      usage: { sessions: row.session_count ?? 0, billed_seconds: row.billed_seconds ?? 0 },
      compute: { byoc_provider: row.compute_provider ?? null },
    });
  });

  app.put("/account/compute", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { provider?: string; api_key?: string } | null;
    if (!body || !body.provider || !body.api_key) return c.json({ error: "provider and api_key required" }, 400);
    if (body.provider !== "e2b" && body.provider !== "daytona") return c.json({ error: "unsupported compute provider" }, 400);
    await store.setCompute(uid, body.provider, encryptKey(body.api_key));
    return c.json({ ok: true });
  });

  app.delete("/account/compute", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    await store.clearCompute(uid);
    return c.json({ ok: true });
  });

  // ---- Billing (task 1 of 5) ----
  app.post("/billing/checkout", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { product?: string; tier?: string; size?: string } | null;
    if (!body) return c.json({ error: "invalid json" }, 400);
    if (body.product !== "sandbox" && body.product !== "vps") return c.json({ error: "product must be sandbox or vps" }, 400);
    if (body.product === "sandbox" && !body.tier) return c.json({ error: "tier required for sandbox" }, 400);
    if (body.product === "vps" && !body.size) return c.json({ error: "size required for vps" }, 400);
    const user = await store.getUser(uid);
    const result = await createCheckoutSession({
      product: body.product,
      tier: body.tier,
      size: body.size,
      userId: uid,
      email: user?.email ?? undefined,
    });
    return c.json({ url: result.url });
  });

  app.post("/billing/portal", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { customerId?: string } | null;
    if (!body?.customerId) return c.json({ error: "customerId required" }, 400);
    const result = await createBillingPortalSession({ customerId: body.customerId });
    return c.json({ url: result.url });
  });

  app.post("/billing/webhook", async (c) => {
    const signature = c.req.header("stripe-signature") ?? "";
    const body = await c.req.text();
    try {
      const result = await handleWebhook({ body, signature });
      return c.json(result);
    } catch (e) {
      console.error("billing webhook error", e);
      return c.json({ error: "webhook rejected" }, 400);
    }
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
    try {
      return c.json(await orch.handshake(c.req.param("id"), raw));
    } catch (e) {
      if (e instanceof StaleProviderKeyError) {
        // Session already failed + error event emitted inside handshake.
        return c.json({ error: "stale_provider_key", message: e.message }, 422);
      }
      throw e;
    }
  });

  app.post("/internal/sessions/:id/events", async (c) => {
    const id = c.req.param("id");
    if (!(await sessionAuth(c))) return c.json({ error: "unauthorized" }, 401);
    const batch = (await c.req.json()) as unknown[];
    for (const raw of batch) {
      const e = Event.parse(raw);
      const payload = JSON.parse(redact(JSON.stringify(e.payload)));
      if (e.type === "state_change" && typeof payload.state === "string") {
        // Only record state changes the FSM accepts — a supervisor emitting
        // "completed" after "failed" must not rewrite history (the UI renders
        // the last state_change in the stream as the session status).
        const accepted = await orch.onSupervisorState(id, payload.state);
        if (!accepted) continue;
      }
      await store.appendEvent(id, { ts: e.ts, type: e.type, payload });
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

// ponytail: minimal MIME map for the preview proxy. Covers the common web
// asset types; unknown → octet-stream (browser downloads instead of rendering).
function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    txt: "text/plain; charset=utf-8", map: "application/json; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}

function selectSandbox(): SandboxProvider {
  const provider = process.env.SANDBOX_PROVIDER ?? (process.env.SANDBOX === "local" ? "local" : "fly");
  switch (provider) {
    case "local":
      return new LocalSandboxProvider();
    case "daytona":
      return new DaytonaProvider(
        process.env.DAYTONA_API_KEY ?? "",
        process.env.DAYTONA_WORKSPACE_ID ?? "",
      );
    case "e2b":
      return new E2BProvider(
        process.env.E2B_API_KEY ?? "",
      );
    case "fly":
    default:
      return new FlyMachinesProvider(
        process.env.FLY_SANDBOX_APP ?? "atelier-sandboxes",
        process.env.FLY_SANDBOX_TOKEN ?? "",
      );
  }
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("index.ts")) {
  // DATABASE_URL (Supabase or any Postgres) → PgStore; otherwise sqlite on disk.
  const store = process.env.DATABASE_URL
    ? await new PgStore(process.env.DATABASE_URL).init()
    : new Store();
  const sandbox = selectSandbox();
  const sp = process.env.SANDBOX_PROVIDER ?? (process.env.SANDBOX === "local" ? "local" : "fly");
  if (sp === "fly" && !process.env.FLY_SANDBOX_TOKEN) {
    console.warn("WARNING: FLY_SANDBOX_TOKEN is not set — every session will fail at provisioning with a Fly 401. Set it (see .env.example) or set SANDBOX_PROVIDER=local.");
  }
  if (sp === "daytona" && !process.env.DAYTONA_API_KEY) {
    console.warn("WARNING: DAYTONA_API_KEY is not set — sessions will fail at provisioning. Set it (see .env.example) or set SANDBOX_PROVIDER=local.");
  }
  if (sp === "e2b" && !process.env.E2B_API_KEY) {
    console.warn("WARNING: E2B_API_KEY is not set — sessions will fail at provisioning. Set it (see .env.example) or set SANDBOX_PROVIDER=local.");
  }
  const orch = new Orchestrator(store, sandbox);
  orch.startReaper();
  const app = buildApp(store, orch);
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`atelier-api listening on :${port}`);
}
