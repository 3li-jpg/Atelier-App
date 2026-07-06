# Handoff: Embed openchamber as Atelier's per-session workspace UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Atelier session gets the full openchamber UI (chat, diffs, git sidebar, terminal, themes) by running the real `@openchamber/web` package inside each sandbox VM, attached to the `opencode serve` we already run — reached from the browser through a new auth-gating reverse-proxy Fly app. Sessions become interactive workspaces instead of one-shot tasks.

**Architecture:** (1) Runner image adds Node 22 + `@openchamber/web`; the supervisor keeps the VM alive after the initial task and finalizes (commit+push) on SIGTERM/SIGINT instead of on bridge exit. (2) A new tiny Fly app `atelier-workspaces` cookie-routes each browser to the right machine over Fly private networking (openchamber must live at a URL **root** — it does not support subpaths, so the control plane cannot proxy it under a path). (3) The control plane gains workspace-attach/finish/activity endpoints and idle-based (not wall-clock-based) reaping; the PWA hub gains "workspace" and "finish" buttons.

**Tech Stack:** Node 22/24, Hono, `node:sqlite`, `node:test`, zero-dependency Node proxy (core `http` only), Fly Machines API, `@openchamber/web@1.14.0`, opencode 1.17.13.

## Global Constraints

- **All Fly work runs against these existing apps:** control plane `atelier-control-plane` (deployed, https://atelier-control-plane.fly.dev), sandboxes `atelier-sandboxes`. NEW app to create: `atelier-workspaces`.
- **Deploy commands are run from repo root.** Secrets for local reference live in gitignored `.env.fly` — append new ones there too, never commit them.
- **Fly account is on the TRIAL plan** — machines are killed after ~5 minutes until a credit card is added. E2E checks that need >5 min of VM uptime will flake until then; this is environmental, not a bug.
- **Pin versions:** `@openchamber/web@1.14.0`, `OPENCODE_VERSION=1.17.13`. New runner image label: `runner-v6`.
- **openchamber requires Node >= 22** — the runner's current apt `nodejs` is too old; Task 7 replaces it with NodeSource Node 22.
- **openchamber only works at a domain root** (no basePath support) and needs WebSocket proxying for `/api/event/ws`, `/api/global/event/ws`, `/api/terminal/ws`, plus unbuffered SSE. The Node-core proxy in Task 5 satisfies this (Node does not buffer piped streams).
- **No new npm dependencies anywhere.** The proxy is Node core only. (`ponytail:` markers on deliberate simplifications, matching repo convention.)
- **TDD:** every code task writes the failing test first, runs it, implements, re-runs. Test runner is `node --experimental-strip-types --test <file>`; `npm test` from repo root runs all workspaces.
- **Style:** match existing code — comments only for non-obvious constraints, `ponytail:` for known ceilings.
- Commit after every task with the message given in the task.

## Context primer (read once, believe it)

Current session flow (batch): `POST /sessions` → orchestrator `launch()` creates a Fly machine (image `RUNNER_IMAGE`, env `SESSION_ID/HANDSHAKE_URL/EVENTS_URL/SESSION_TOKEN`) → `runner/supervisor.sh` (PID 1) fetches config via sealed-box handshake, clones the repo to `/workspace/repo`, applies the egress firewall, writes opencode provider config, starts `opencode serve --hostname 127.0.0.1 --port 4096`, runs `runner/bridge.mjs` which POSTs the task prompt and relays opencode SSE events to the control plane; on `session.idle` the bridge **exits**, the supervisor commits+pushes and emits `completed`, machine self-destructs (`auto_destroy: true`).

Key files:
- `apps/api/src/index.ts` — Hono app. Auth middleware guards `GUARDED = /^\/(sessions|providers|repos)(\/|$)/` (session cookie, or `Bearer $AUTH_TOKEN`, or open when nothing configured). Internal runner routes are under `/internal/sessions/:id/*` gated by `sessionAuth()` (the per-session bearer). Ownership pattern for user routes: fetch session, compare `s.user_id` to `uidOf(c)`, mismatched → 404.
- `apps/api/src/orchestrator.ts` — FSM driver, hibernation (`scheduleSuspend`: suspend after `SUSPEND_AFTER_MS` in `awaiting_user`, then a nested stop timer — the stop timer is REMOVED by this plan because a stopped Fly machine loses its rootfs, i.e. the workspace), reaper (currently wall-clock TTL — becomes idle-based).
- `apps/api/src/store.ts` — `node:sqlite`. `sessions` table has `machine_id`, `session_token`, `user_id`, `budgets` (JSON, `max_wall_clock_s`), `started_at` (sqlite `datetime('now')`, UTC without Z — parse with `new Date(x + "Z")`).
- `apps/api/src/auth.ts` — HMAC-signed-cookie helpers (`signSession`/`verifySession`, secret = `SESSION_SECRET || MASTER_KEY`). The workspace attach token in Task 3 copies this scheme.
- `packages/schema/src/index.ts` — `SessionState` enum + `TRANSITIONS` map (FSM legality).
- `packages/sandbox/src/fly.ts` — `FlyMachinesProvider` (create/suspend/resume/stop/destroy/waitFor via api.machines.dev).
- `runner/supervisor.sh`, `runner/bridge.mjs`, `runner/firewall.sh` (egress-only nftables: `policy drop` on **output**, `ct state established,related accept` — inbound connections to the VM work and their replies are allowed, so serving openchamber on :3000 over Fly private networking needs NO firewall change), `runner/Dockerfile`.
- `apps/web/src/` — React PWA. `App.tsx` (view-state nav, no router), `views/SessionView.tsx` (timeline + composer), `api.ts` (fetch wrapper; `credentials: "include"`, optional `Authorization` from localStorage).
- `infra/fly.api.toml` — control plane deploy config; copy its shape for the new proxy toml.

Fly private networking fact the proxy relies on: from any machine in the same Fly org, `http://<machine_id>.vm.<app-name>.internal:<port>` reaches that specific machine (IPv6 6PN; Fly VMs resolve `.internal` via their default resolver — plain `http.request` works).

opencode server password is REMOVED by this plan (supervisor currently sets `OPENCODE_SERVER_PASSWORD`): openchamber's ability to pass basic-auth to a remote opencode is undocumented, and the server binds 127.0.0.1 inside a single-tenant VM — the localhost boundary is the real isolation. Bridge keeps password support only if the env var is present.

---

### Task 1: FSM — allow finalizing from interactive states

**Files:**
- Modify: `packages/schema/src/index.ts` (TRANSITIONS map, ~line 26)
- Test: `packages/schema/src/schema.test.ts` (check filename: whatever `npm test -w @atelier/schema` runs; if no test file exists, create `packages/schema/src/schema.test.ts` and add a `"test"` script mirroring `apps/api/package.json`'s)

**Interfaces:**
- Produces: `canTransition("awaiting_user","finalizing") === true`, `canTransition("hibernated","finalizing") === true`. Tasks 4 and 8 rely on these (supervisor emits `finalizing` on graceful stop, which now can arrive while the session sits in `awaiting_user` or `hibernated`).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert";
import { canTransition } from "./index.ts";

test("graceful finish is legal from interactive states", () => {
  assert.equal(canTransition("awaiting_user", "finalizing"), true);
  assert.equal(canTransition("hibernated", "finalizing"), true);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`false !== true`):
`node --experimental-strip-types --test packages/schema/src/schema.test.ts`

- [ ] **Step 3: Implement** — in `TRANSITIONS`, change:

```ts
  awaiting_user: ["running", "hibernated", "finalizing", "failed", "cancelled"],
  hibernated: ["awaiting_user", "running", "finalizing", "failed", "cancelled"],
```

- [ ] **Step 4: Re-run test — expect PASS.** Then `npm test` from repo root — all existing tests must still pass (none encode the old exits; if one does, update its expectation and say so in the commit body).

- [ ] **Step 5: Commit** — `git commit -m "schema: allow awaiting_user/hibernated -> finalizing (interactive sessions)"`

---

### Task 2: Store — last-activity tracking

**Files:**
- Modify: `apps/api/src/store.ts`
- Test: `apps/api/src/api.test.ts` (append; the file's fixture is `function setup()` → `{ store, sandbox, app }` with a `FakeSandbox`; sessions are created over HTTP — copy the provider-POST + `/sessions`-POST sequence from the `"full session lifecycle over HTTP"` test)

**Interfaces:**
- Produces: `store.touchActivity(id: string): void` (sets `last_activity` to now) and a `last_activity` column returned by `getSession(id)` (sqlite `TEXT`, UTC, no Z — same convention as `started_at`; `null` until first touch).

- [ ] **Step 1: Write the failing test**

```ts
test("touchActivity stamps last_activity", async () => {
  const { store, app } = setup();
  // create provider + session exactly like the "full session lifecycle" test, capture sessionId
  const id = sessionId;
  assert.equal(store.getSession(id).last_activity, null);
  store.touchActivity(id);
  const t = new Date(store.getSession(id).last_activity + "Z").getTime();
  assert.ok(Math.abs(Date.now() - t) < 5000);
});
```

- [ ] **Step 2: Run — expect FAIL** (`touchActivity is not a function`):
`node --experimental-strip-types --test apps/api/src/api.test.ts`

- [ ] **Step 3: Implement** — in `store.ts`: next to the existing `safeAlter(...user_id...)` call (~line 37) add:

```ts
    safeAlter(this.db, "alter table sessions add column last_activity text");
```

and add the method near `setSessionState`:

```ts
  touchActivity(id: string) {
    this.db.prepare("update sessions set last_activity = datetime('now') where id = ?").run(id);
  }
```

- [ ] **Step 4: Re-run test file — expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "store: last_activity column + touchActivity"`

---

### Task 3: Auth — workspace attach token

**Files:**
- Modify: `apps/api/src/auth.ts`
- Test: `apps/api/src/api.test.ts` (append)

**Interfaces:**
- Produces:
  - `signWorkspaceToken(sessionId: string, userId: string, secret?: string): string` — HMAC token, 5-minute expiry, format `<b64url payload>.<b64url hmac>` (same scheme as `signSession`).
  - `verifyWorkspaceToken(token: string | null | undefined, secret?: string): { sid: string; uid: string } | null`.
- Consumed by: Task 4's `/sessions/:id/workspace` route; the proxy (Task 5) re-implements `verify` locally (zero-dep app — deliberate 20-line duplication, `ponytail:` mark it there).

- [ ] **Step 1: Write the failing test**

```ts
import { signWorkspaceToken, verifyWorkspaceToken } from "./auth.ts";

test("workspace token round-trips and rejects tampering", () => {
  const tok = signWorkspaceToken("ses-1", "user-1", "s3cret");
  assert.deepEqual(verifyWorkspaceToken(tok, "s3cret"), { sid: "ses-1", uid: "user-1" });
  assert.equal(verifyWorkspaceToken(tok, "wrong"), null);
  assert.equal(verifyWorkspaceToken(tok + "x", "s3cret"), null);
  assert.equal(verifyWorkspaceToken(null, "s3cret"), null);
});
```

- [ ] **Step 2: Run — expect FAIL** (not exported).

- [ ] **Step 3: Implement** in `auth.ts`, reusing the file's existing `b64u`, `sign`, `timingSafeEqual` helpers:

```ts
// Workspace attach token: short-lived, carries session + user for the proxy.
export function signWorkspaceToken(sessionId: string, userId: string, secret = sessionSecret()): string {
  const payload = b64u(JSON.stringify({ sid: sessionId, uid: userId, exp: Date.now() + 5 * 60_000 }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyWorkspaceToken(token: string | undefined | null, secret = sessionSecret()): { sid: string; uid: string } | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { sid, uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return { sid: String(sid), uid: String(uid) };
  } catch { return null; }
}
```

- [ ] **Step 4: Re-run — expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "auth: signed workspace attach tokens"`

---

### Task 4: Orchestrator + API routes — interactive lifecycle

**Files:**
- Modify: `apps/api/src/orchestrator.ts`, `apps/api/src/index.ts`, `packages/sandbox/src/fly.ts`
- Test: `apps/api/src/api.test.ts` (append; ALSO update existing tests that encode the old behavior: delete the `process.env.STOP_AFTER_MS = "60"` line at the top, and rewrite the test at ~line 146 `"hibernation: awaiting_user suspends, stop follows, reply wakes; reaper kills TTL breaches"` — stop no longer follows suspend, and the reaper now finishes idle sessions gracefully instead of killing on wall-clock TTL. The file already sets `process.env.SUSPEND_AFTER_MS = "30"` for fast timers — keep using that.)

**Interfaces:**
- Consumes: Task 1 transitions, Task 2 `touchActivity`, Task 3 token helpers.
- Produces (env contract for later tasks): control plane env vars `PROXY_TOKEN` (shared secret with proxy app) and `WORKSPACES_URL` (e.g. `https://atelier-workspaces.fly.dev`). New HTTP surface:
  - `GET  /sessions/:id/workspace` (user-authed, owner-scoped) → 302 to `${WORKSPACES_URL}/attach?token=<signWorkspaceToken>`; 409 `{error:"no machine"}` if the session has no machine; 404 for non-owners (mirror the existing `/sessions/:id` ownership check).
  - `POST /sessions/:id/finish` (user-authed, owner-scoped) → `{ok:true}`; graceful end.
  - `GET  /internal/workspace/:id` (Bearer `PROXY_TOKEN`) → `{ machine_id: string|null, state: SessionState }`.
  - `POST /internal/workspace/:id/wake` (Bearer `PROXY_TOKEN`) → `{ok:true}`; resumes a hibernated machine.
  - `POST /internal/workspace/:id/activity` (Bearer `PROXY_TOKEN`) → `{ok:true}`; marks activity, defers suspend.
- Orchestrator API: `activity(id)`, `finish(id)` (both public), suspend delay default bumped to 300 000 ms.

**Behavior spec:**
1. **No machine stop on idle.** `scheduleSuspend` keeps ONLY the suspend step (suspend preserves RAM+rootfs; a *stopped* Fly machine reboots from the image and loses `/workspace` — that was fine for batch, fatal for workspaces). Delete the nested `STOP_AFTER_MS` timer and the `STOP_AFTER_MS` const.
2. **`SUSPEND_AFTER_MS` default 300_000** (was 30_000): the proxy pings activity at most once per 60 s, so the suspend fuse must exceed the ping interval.
3. **`activity(id)`**: `store.touchActivity(id)`; if current state is `awaiting_user`, re-arm the suspend timer (`this.scheduleSuspend(id)`). Also call `this.activity(sessionId)` inside the existing `/internal/sessions/:id/events` ingest handler in `index.ts` (runner events count as activity).
4. **`finish(id)`** — graceful end:

```ts
  async finish(sessionId: string): Promise<void> {
    const s = this.store.getSession(sessionId);
    if (!s) return;
    if (!s.machine_id) {
      if (canTransition(s.state, "cancelled")) this.transition(sessionId, "cancelled");
      return;
    }
    const ref = { id: s.machine_id, provider: "fly" as const };
    if (s.state === "hibernated") {
      await this.sandbox.resume(ref);
      await this.sandbox.waitFor(ref, "started", 30).catch(() => {});
      this.transition(sessionId, "awaiting_user");
    }
    // SIGINT/SIGTERM -> supervisor finalize (commit+push) -> emits completed -> reap
    await this.sandbox.stop(ref).catch(() => {});
    this.setTimer(sessionId, "finish", 180_000, () => { void this.kill(sessionId, "finish timed out"); });
  }
```

   Add `"finish"` to the kinds cleared in `clearBudget()` so a `completed` arrival cancels the safety kill.
5. **Reaper: idle-based.** In `sweep()`, replace the wall-clock kill with: `lastMs = new Date((s.last_activity ?? s.started_at) + "Z").getTime()`; if `now - startedMs > 24h` → `kill` (absolute cap); else if `now - lastMs > maxMs` (existing `budgets.max_wall_clock_s`, default 1800) → `await this.finish(s.id)` (graceful, work gets pushed).
6. **`launch()` budget timer**: delete the `setTimer(sessionId, "budget", ...)` wall-clock kill in `launch()` — the reaper's idle logic replaces it (a hard timer would kill active interactive sessions at 30 min).
7. **Machine kill window**: in `packages/sandbox/src/fly.ts` `create()`, add `kill_timeout: 120` inside the `config` object (default is 5 s — not enough for the supervisor's commit+push on stop). One-line change.
8. **Routes** (in `buildApp`): follow the exact auth/ownership idioms already in the file. For internal ones define once:

```ts
  const proxyAuth = (c: any) => {
    const t = process.env.PROXY_TOKEN;
    return Boolean(t && c.req.header("Authorization") === `Bearer ${t}`);
  };
```

- [ ] **Step 1: Write failing tests.** Use the file's `setup()` fixture (`{ store, sandbox, app }`; `sandbox` is `FakeSandbox` recording `calls: string[]` like `"suspend"`/`"resume"`/`"stop"` and `destroyed: string[]`). Create sessions over HTTP as the lifecycle test does, then drive the orchestrator directly (`const orch = new Orchestrator(store, sandbox)` is buried inside `setup()` — either return it from `setup()` (small fixture edit, fine) or build store/sandbox/orch inline). The existing hibernation test (~line 146) shows how to push a session into `awaiting_user` (`orch.onSupervisorState(id, "awaiting_user")`) and await fast timers (`SUSPEND_AFTER_MS=30`). Required tests — write them fully, every assertion below must appear:

```ts
test("activity while awaiting_user defers suspend", async () => {
  // session in awaiting_user; every 20ms for 5 ticks call orch.activity(id);
  // after 100ms total (>> SUSPEND_AFTER_MS=30) assert:
  assert.ok(!sandbox.calls.includes("suspend"));
  assert.ok(store.getSession(id).last_activity !== null);
  // then stop calling activity, wait 60ms, assert suspend DID fire:
  assert.ok(sandbox.calls.includes("suspend"));
});

test("finish stops the machine gracefully and reaps on completed", async () => {
  // session in running with machine_id set (launch() via the HTTP flow sets m-1)
  await orch.finish(id);
  assert.ok(sandbox.calls.includes("stop"));
  orch.onSupervisorState(id, "finalizing");
  orch.onSupervisorState(id, "completed");
  assert.equal(store.getSession(id).state, "completed");
  assert.deepEqual(sandbox.destroyed, ["m-1"]); // reap on completed
});

test("finish resumes a hibernated machine before stopping it", async () => {
  // put session in hibernated (onSupervisorState awaiting_user, await suspend timer)
  await orch.finish(id);
  assert.ok(sandbox.calls.indexOf("resume") < sandbox.calls.indexOf("stop"));
});

test("reaper finishes idle sessions instead of killing", async () => {
  // session in awaiting_user, created with budgets {max_wall_clock_s: 0} in the
  // POST /sessions body so it is instantly "idle past budget"
  await orch.sweep();
  assert.ok(sandbox.calls.includes("stop"));           // graceful finish
  assert.notEqual(store.getSession(id).state, "failed"); // not killed
});

test("workspace redirect round-trip", async (t) => {
  t.after(() => { delete process.env.WORKSPACES_URL; });
  process.env.WORKSPACES_URL = "https://ws.example";
  // owner-authed GET (see the per-user scoping test for cookie construction):
  const res = await app.request(`/sessions/${id}/workspace`, { headers: ownerHeaders });
  assert.equal(res.status, 302);
  const loc = res.headers.get("location")!;
  assert.ok(loc.startsWith("https://ws.example/attach?token="));
  assert.equal(verifyWorkspaceToken(new URL(loc).searchParams.get("token"))!.sid, id);
  // non-owner -> 404 (mirror per-user scoping test's second-user setup)
  // session without machine_id -> 409
});

test("internal workspace endpoints gate on PROXY_TOKEN", async (t) => {
  t.after(() => { delete process.env.PROXY_TOKEN; });
  process.env.PROXY_TOKEN = "pt";
  let res = await app.request(`/internal/workspace/${id}`);
  assert.equal(res.status, 401);
  res = await app.request(`/internal/workspace/${id}`, { headers: { Authorization: "Bearer pt" } });
  assert.deepEqual(await res.json(), { machine_id: "m-1", state: store.getSession(id).state });
  res = await app.request(`/internal/workspace/${id}/activity`, { method: "POST", headers: { Authorization: "Bearer pt" } });
  assert.equal(res.status, 200);
  assert.ok(store.getSession(id).last_activity !== null);
});
```

(The comment lines are setup guidance, not skippable work — replace each with the real arrangement code it describes.)

- [ ] **Step 2: Run — expect FAIL** on every new test.

- [ ] **Step 3: Implement** per the behavior spec above.

- [ ] **Step 4: Run the whole suite** (`npm test`) — new tests pass, old tests updated where they encoded the stop-timer / wall-clock behavior (list every changed expectation in the commit body).

- [ ] **Step 5: Commit** — `git commit -m "api: interactive session lifecycle (workspace attach, finish, idle reaping)"`

---

### Task 5: Workspace proxy app

**Files:**
- Create: `apps/workspace-proxy/package.json`, `apps/workspace-proxy/src/helpers.mjs`, `apps/workspace-proxy/src/helpers.test.mjs`, `apps/workspace-proxy/src/index.mjs`, `apps/workspace-proxy/Dockerfile`
- Create: `infra/fly.workspaces.toml`

**Interfaces:**
- Consumes: control plane internal endpoints from Task 4; attach tokens from Task 3.
- Produces: a Fly app at `WORKSPACES_URL` whose behavior is:
  - `GET /attach?token=...` → verify → `Set-Cookie: atelier_ws=<signed {sid,exp:7d}>; HttpOnly; Secure; SameSite=Lax; Path=/` → 302 `/`.
  - Everything else: require valid cookie → resolve `sid` → machine via control plane (cached 30 s) → reverse-proxy (HTTP + WebSocket upgrade) to `http://<machine_id>.vm.<SANDBOX_APP>.internal:3000`.
  - If session `hibernated`: fire wake, return a self-refreshing "waking your workspace…" page (also on upstream `ECONNREFUSED`/`ENOTFOUND` for HTML navigations; plain 502 for others).
  - Throttled activity ping: at most one `POST /internal/workspace/:sid/activity` per sid per 60 s.
- Env: `PORT` (8080), `SESSION_SECRET`, `PROXY_TOKEN`, `CONTROL_PLANE_URL`, `SANDBOX_APP`.

- [ ] **Step 1: package.json**

```json
{
  "name": "@atelier/workspace-proxy",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test src/helpers.test.mjs", "start": "node src/index.mjs" }
}
```

(`apps/*` is already in the root workspaces glob — `npm test` picks it up automatically.)

- [ ] **Step 2: Write failing helper tests** — `src/helpers.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { signCookie, verifyCookie, verifyAttachToken, parseCookies, pingDue } from "./helpers.mjs";

test("cookie round-trip", () => {
  const c = signCookie("ses-1", "s3cret");
  assert.equal(verifyCookie(c, "s3cret"), "ses-1");
  assert.equal(verifyCookie(c, "wrong"), null);
  assert.equal(verifyCookie("garbage", "s3cret"), null);
});

test("attach token verification matches control-plane format", () => {
  // build a token exactly like apps/api/src/auth.ts signWorkspaceToken
  const payload = Buffer.from(JSON.stringify({ sid: "s1", uid: "u1", exp: Date.now() + 60000 })).toString("base64url");
  const sig = createHmac("sha256", "k").update(payload).digest("base64url");
  assert.deepEqual(verifyAttachToken(`${payload}.${sig}`, "k"), { sid: "s1", uid: "u1" });
  const stale = Buffer.from(JSON.stringify({ sid: "s1", uid: "u1", exp: Date.now() - 1 })).toString("base64url");
  const sig2 = createHmac("sha256", "k").update(stale).digest("base64url");
  assert.equal(verifyAttachToken(`${stale}.${sig2}`, "k"), null);
});

test("parseCookies", () => {
  assert.equal(parseCookies("a=1; atelier_ws=x.y; b=2").atelier_ws, "x.y");
  assert.deepEqual(parseCookies(undefined), {});
});

test("pingDue throttles per sid", () => {
  const last = new Map();
  assert.equal(pingDue(last, "s1", 1000), true);
  assert.equal(pingDue(last, "s1", 30_000), false);
  assert.equal(pingDue(last, "s1", 62_000), true);
});
```

(Note: top-level `await import` inside a sync test is invalid — make that test callback `async`.)

- [ ] **Step 3: Run — expect FAIL** (`node --test apps/workspace-proxy/src/helpers.test.mjs`), then implement `src/helpers.mjs`:

```js
// ponytail: HMAC helpers duplicated from apps/api/src/auth.ts — this app is
// deliberately zero-dep and can't import TS from the api workspace.
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

function verifySigned(token, secret) {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
}

export function verifyAttachToken(token, secret) {
  const p = verifySigned(token, secret);
  if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return { sid: String(p.sid), uid: String(p.uid) };
}

export function signCookie(sid, secret) {
  const payload = Buffer.from(JSON.stringify({ sid, exp: Date.now() + 7 * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyCookie(cookie, secret) {
  const p = verifySigned(cookie, secret);
  if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return String(p.sid);
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// at most one activity ping per sid per minute
export function pingDue(lastPing, sid, now = Date.now()) {
  const prev = lastPing.get(sid) ?? 0;
  if (now - prev < 60_000) return false;
  lastPing.set(sid, now);
  return true;
}
```

Re-run — expect PASS.

- [ ] **Step 4: Write `src/index.mjs`** (no unit test — it's glue over Node core + live network; e2e covers it in Task 8):

```js
// Workspace proxy: cookie-routes a browser to its session's sandbox machine over
// Fly 6PN. openchamber must live at a URL root, hence a dedicated app/hostname.
import http from "node:http";
import { verifyAttachToken, signCookie, verifyCookie, parseCookies, pingDue } from "./helpers.mjs";

const {
  PORT = "8080", SESSION_SECRET = "", PROXY_TOKEN = "",
  CONTROL_PLANE_URL = "", SANDBOX_APP = "atelier-sandboxes",
} = process.env;
for (const [k, v] of [["SESSION_SECRET", SESSION_SECRET], ["PROXY_TOKEN", PROXY_TOKEN], ["CONTROL_PLANE_URL", CONTROL_PLANE_URL]]) {
  if (!v) { console.error(`workspace-proxy: ${k} required`); process.exit(1); }
}

const COOKIE = "atelier_ws";
const cache = new Map();   // sid -> { machine_id, state, ts }  (30s TTL)
const lastPing = new Map(); // sid -> ts of last activity ping

async function lookup(sid) {
  const hit = cache.get(sid);
  if (hit && Date.now() - hit.ts < 30_000) return hit;
  const res = await fetch(`${CONTROL_PLANE_URL}/internal/workspace/${sid}`, {
    headers: { Authorization: `Bearer ${PROXY_TOKEN}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const entry = { ...body, ts: Date.now() };
  cache.set(sid, entry);
  return entry;
}

function cpPost(path) { // fire-and-forget control-plane POST
  fetch(`${CONTROL_PLANE_URL}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${PROXY_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

const WAKING = `<!doctype html><meta http-equiv="refresh" content="3"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>waking your workspace…</p></body>`;
const waking = (res) => { res.writeHead(503, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(WAKING); };

function target(entry) { return { host: `${entry.machine_id}.vm.${SANDBOX_APP}.internal`, port: 3000 }; }

// resolve the session for a request; null -> response already sent
function sessionOf(req, res) {
  const sid = verifyCookie(parseCookies(req.headers.cookie)[COOKIE], SESSION_SECRET);
  if (!sid) { res.writeHead(403, { "Content-Type": "text/plain" }); res.end("not attached — open the workspace from the Atelier hub"); return null; }
  return sid;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }

  if (url.pathname === "/attach") {
    const t = verifyAttachToken(url.searchParams.get("token"), SESSION_SECRET);
    if (!t) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("bad or expired attach link — reopen from the Atelier hub"); }
    res.writeHead(302, {
      "Set-Cookie": `${COOKIE}=${signCookie(t.sid, SESSION_SECRET)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 86400}`,
      Location: "/",
    });
    return res.end();
  }

  const sid = sessionOf(req, res);
  if (!sid) return;
  const entry = await lookup(sid).catch(() => null);
  if (!entry?.machine_id) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("session has no machine (finished?)"); }
  if (entry.state === "hibernated") { cpPost(`/internal/workspace/${sid}/wake`); cache.delete(sid); return waking(res); }
  if (pingDue(lastPing, sid)) cpPost(`/internal/workspace/${sid}/activity`);

  const { host, port } = target(entry);
  const preq = http.request(
    { host, port, path: req.url, method: req.method, headers: { ...req.headers, host: `${host}:${port}` } },
    (pres) => { res.writeHead(pres.statusCode ?? 502, pres.headers); pres.pipe(res); },
  );
  preq.on("error", () => {
    if (res.headersSent) return res.destroy();
    // machine still booting (or suspended and wake in flight) — show waking page on navigations
    if ((req.headers.accept ?? "").includes("text/html")) { cache.delete(sid); return waking(res); }
    res.writeHead(502, { "Content-Type": "text/plain" }); res.end("upstream unavailable");
  });
  req.pipe(preq);
});

// WebSocket passthrough (openchamber: /api/event/ws, /api/global/event/ws, /api/terminal/ws)
server.on("upgrade", async (req, socket) => {
  const bail = () => socket.destroy();
  const sid = verifyCookie(parseCookies(req.headers.cookie)[COOKIE], SESSION_SECRET);
  if (!sid) return bail();
  const entry = await lookup(sid).catch(() => null);
  if (!entry?.machine_id || entry.state === "hibernated") return bail();
  const { host, port } = target(entry);
  const preq = http.request({ host, port, path: req.url, method: req.method, headers: { ...req.headers, host: `${host}:${port}` } });
  preq.on("upgrade", (pres, psocket, phead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (let i = 0; i < pres.rawHeaders.length; i += 2) lines.push(`${pres.rawHeaders[i]}: ${pres.rawHeaders[i + 1]}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (phead?.length) psocket.unshift(phead);
    psocket.pipe(socket); socket.pipe(psocket);
    psocket.on("error", bail); socket.on("error", () => psocket.destroy());
  });
  preq.on("error", bail);
  preq.end();
});

server.listen(Number(PORT), "0.0.0.0", () => console.log(`workspace-proxy on :${PORT}`));
```

- [ ] **Step 5: Dockerfile + fly toml**

`apps/workspace-proxy/Dockerfile` (build context = repo root, same convention as the api):

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY apps/workspace-proxy/src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/index.mjs"]
```

`infra/fly.workspaces.toml`:

```toml
app = "atelier-workspaces"
primary_region = "sjc"

[build]
  dockerfile = "../apps/workspace-proxy/Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"    # stateless; cookie lives in the browser
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 6: Run `npm test` from repo root** — helper tests green, everything else green.

- [ ] **Step 7: Commit** — `git commit -m "workspace-proxy: cookie-routing reverse proxy app (HTTP+WS) to sandbox machines"`

---

### Task 6: Hub UI — workspace/finish buttons + login error surfacing

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/views/SessionView.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /sessions/:id/workspace` (302 — reached by plain navigation, NOT fetch), `POST /sessions/:id/finish`. `SessionDetail` gains `machine_id: string | null` (the API already returns it — `getSession` selects `*`; just add it to the TS type in `api.ts`).

- [ ] **Step 1: `api.ts`** — add to the `SessionDetail` type: `machine_id: string | null;` and next to `cancelSession` add (copy its exact `req` idiom):

```ts
  finishSession: (id: string) => req<{ ok: boolean }>(`/sessions/${id}/finish`, { method: "POST" }),
```

- [ ] **Step 2: `SessionView.tsx`** — in the `<header className="topbar">`, next to the cancel button, add (workspace opens via full navigation so the server 302 + cross-site cookie flow works; `target="_blank"` keeps the hub alive):

```tsx
        {!terminal && session?.machine_id && (
          <a className="ghost" href={`/sessions/${id}/workspace`} target="_blank" rel="noreferrer" title="open workspace (openchamber)">
            workspace ↗
          </a>
        )}
        {!terminal && (
          <button className="ghost" title="finish: commit, push & shut down" onClick={() => api.finishSession(id).catch(() => {})}>
            finish
          </button>
        )}
```

Note: the existing `✕` cancel button stays — cancel = discard (machine destroyed, nothing pushed); finish = graceful (commit+push). Keep both, they mean different things.

- [ ] **Step 3: `App.tsx`** — surface the OAuth callback error that is currently swallowed (login-bug fallout; the server redirects to `/?auth_error=...` on OAuth failure and today nothing reads it). Inside `App()` before the return:

```tsx
  const authError = new URLSearchParams(window.location.search).get("auth_error");
```

and directly under the `<header>…</header>` block:

```tsx
      {authError && <div className="state-banner tone-bad">login failed: {authError}</div>}
```

(`state-banner`/`tone-bad` already exist in `styles.css` — verify with grep; if the tone class is named differently, use the one `stateTone` maps failures to in `lib.ts`.)

- [ ] **Step 4: Verify** — `npm run build -w @atelier/web` compiles clean (`tsc --noEmit` runs inside it); `npm test` still green.

- [ ] **Step 5: Commit** — `git commit -m "web: workspace + finish actions; surface auth_error from OAuth callback"`

---

### Task 7: Runner — Node 22, openchamber, interactive supervisor, bridge rework

**Files:**
- Modify: `runner/Dockerfile`, `runner/supervisor.sh`, `runner/bridge.mjs`

**Interfaces:**
- Consumes: FSM transitions from Task 1 (supervisor now emits `finalizing`→`completed` from `awaiting_user`).
- Produces: runner image `runner-v6` where the VM stays alive after the initial task, openchamber listens on `0.0.0.0:3000`, and SIGTERM/SIGINT triggers commit+push+`completed`.

- [ ] **Step 1: `runner/Dockerfile`** — replace apt node with NodeSource 22 and install openchamber. Full new file:

```dockerfile
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    python3 python3-pip nftables openssh-client dnsutils \
 && rm -rf /var/lib/apt/lists/*
# Node 22 (openchamber requires >=22; ubuntu's apt nodejs is older)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
# OpenCode — pin an exact version; treat as a vendored dependency
ARG OPENCODE_VERSION=1.17.13
RUN curl -fsSL https://opencode.ai/install | VERSION=${OPENCODE_VERSION} bash \
 && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode
# openchamber — the per-session workspace UI (handoff-openchamber.md)
ARG OPENCHAMBER_VERSION=1.14.0
RUN npm install -g @openchamber/web@${OPENCHAMBER_VERSION}
WORKDIR /workspace
COPY firewall.sh /usr/local/bin/firewall.sh
COPY handshake.mjs /usr/local/bin/handshake.mjs
COPY bridge.mjs /usr/local/bin/bridge.mjs
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor /usr/local/bin/firewall.sh
ENTRYPOINT ["/usr/local/bin/supervisor"]
```

Build it locally to catch native-module failures early (better-sqlite3/node-pty compile during npm install; build-essential + python3 are present):
`docker build -t atelier-runner-test runner/` — must exit 0. Then sanity-check inside: `docker run --rm --entrypoint bash atelier-runner-test -lc "node --version && openchamber --help | head -30"` — expect `v22.x` and a usage screen; **confirm the flags `--port` and `--lan` exist and note whether `--ui-password` is required** (see Risks).

- [ ] **Step 2: `runner/supervisor.sh`** — replace everything from `emit state_change '{"state":"running"}'` to the end of the file with:

```bash
emit state_change '{"state":"running"}'
REPLIES_URL="${EVENTS_URL%/events}/replies"
# No server password: opencode binds 127.0.0.1 in a single-tenant VM; the
# localhost boundary is the isolation. (openchamber's remote-auth support is
# undocumented — password removed rather than guessed at.)
opencode serve --hostname 127.0.0.1 --port 4096 >"$WORKSPACE/opencode.log" 2>&1 &
OC_PID=$!

# openchamber workspace UI — attaches to the opencode server above; reachable
# from the workspace proxy over Fly 6PN on :3000 (egress firewall only filters
# outbound; established-state replies to inbound connections pass).
OPENCODE_SKIP_START=true OPENCODE_HOST=http://127.0.0.1:4096 \
  openchamber --lan --port 3000 >"$WORKSPACE/openchamber.log" 2>&1 &
CHAMBER_PID=$!

finalize() {  # graceful stop (fly machine stop -> SIGINT; kill_timeout=120s window)
  trap - TERM INT EXIT
  emit state_change '{"state":"finalizing"}'
  kill "$BRIDGE_PID" "$CHAMBER_PID" "$OC_PID" 2>/dev/null || true
  cd "$WORKSPACE/repo"
  if [[ -n "$(git status --porcelain)" || -n "$(git log origin/$BRANCH..HEAD --oneline 2>/dev/null)" ]]; then
    git checkout -b "atelier/$(date +%s)" 2>/dev/null || true
    git add -A
    git diff --cached --quiet || git commit -m "Atelier: ${TASK:0:60}"
    if [[ -n "$GIT_TOKEN" ]]; then
      git push -u origin HEAD && emit commit "{\"branch\":\"$(git branch --show-current)\"}"
    else
      emit error '{"message":"no git token — changes committed locally only"}'
    fi
  fi
  emit state_change '{"state":"completed"}'
  exit 0
}
trap finalize TERM INT

# Bridge relays opencode events for the hub timeline and injects the initial
# task; it now runs for the whole session (idle no longer stops it).
OC_PORT=4096 REPLIES_URL="$REPLIES_URL" TASK="$TASK" node "${RUNNER_BIN}/bridge.mjs" &
BRIDGE_PID=$!
wait "$BRIDGE_PID" || true
# reaching here without a signal = opencode/bridge died -> EXIT trap emits failed
exit 1
```

Keep the existing EXIT trap (it turns the fall-through `exit 1` into `error` + `failed` events) and the existing TERM/INT trap line — DELETE the old TERM/INT trap (`trap 'emit error ... exit 143' TERM INT`) since `trap finalize TERM INT` replaces it. Also delete the old `OC_PASSWORD=$(openssl rand -hex 16)` / `export OPENCODE_SERVER_PASSWORD` lines and the old post-bridge finalize block (all of it — the new `finalize()` is its only home). Sanity: `bash -n runner/supervisor.sh` must pass.

- [ ] **Step 3: `runner/bridge.mjs`** — three changes:

(a) Make the password optional: replace the required-vars check with

```js
for (const [k, v] of [["TASK", TASK]]) {
  if (!v) { console.error(`bridge: ${k} is required`); process.exit(1); }
}
```

and make the auth header conditional:

```js
const OC_HEADERS = { "Content-Type": "application/json", ...(OC_PASSWORD ? { Authorization: AUTH } : {}) };
```

Also guard the two places that pass `{ headers: { Authorization: AUTH } }` directly (`waitForHealth`, `consumeSSE`): use `OC_PASSWORD ? { Authorization: AUTH } : {}`.

(b) In `mapEvent`, session idle no longer completes the session — it hands control to the user (the FSM's `awaiting_user`), and busy flips back to `running` so the hibernation timer can't fire mid-run:

```js
  // session idle -> interactive lull: hand to user, keep relaying
  if (type === "session.idle" || (type === "session.status" && (p.status?.type === "idle" || p.status === "idle"))) {
    return { atelier: { type: "state_change", payload: { state: "awaiting_user" } } };
  }
  // busy -> running (defers the control plane's suspend timer)
  if (type === "session.status") {
    const busy = p.status?.type === "busy" || p.status === "busy";
    return busy ? { atelier: { type: "state_change", payload: { state: "running" } } } : {};
  }
```

(The old `stop: true` and the `busy -> drop` line are gone.)

(c) In `consumeSSE`, the stream ending is now always an error (there is no legitimate self-stop):

```js
    if (done) throw new Error("opencode SSE stream ended");
```

and remove the `state.stopped` machinery everywhere it appears (`pollReplies`'s loop condition becomes `while (true)`). Grep for `stopped` to catch all of them. `node --check runner/bridge.mjs` must pass.

- [ ] **Step 4: Commit** — `git commit -m "runner: openchamber workspace, interactive supervisor (finalize on signal), bridge relays forever"`

---

### Task 8: Deploy + end-to-end verification

**Files:** none (ops). Have `.env.fly` at repo root for existing secret values.

- [ ] **Step 1: Create the proxy app + secrets** (generate a fresh PROXY_TOKEN: `openssl rand -hex 32`; SESSION_SECRET value = the one in `.env.fly`):

```bash
fly apps create atelier-workspaces
fly secrets set -a atelier-workspaces \
  SESSION_SECRET=<from .env.fly> \
  PROXY_TOKEN=<new random> \
  CONTROL_PLANE_URL=https://atelier-control-plane.fly.dev \
  SANDBOX_APP=atelier-sandboxes
```

Append `PROXY_TOKEN=...` to `.env.fly` (it's gitignored — verify with `git check-ignore .env.fly` before writing).

- [ ] **Step 2: Push the new runner image**

```bash
cd runner && fly deploy --build-only --push -a atelier-sandboxes --image-label runner-v6 && cd ..
```

- [ ] **Step 3: Control plane secrets + deploy**

```bash
fly secrets set -a atelier-control-plane \
  PROXY_TOKEN=<same random> \
  WORKSPACES_URL=https://atelier-workspaces.fly.dev \
  RUNNER_IMAGE=registry.fly.io/atelier-sandboxes:runner-v6
flyctl deploy -c infra/fly.api.toml --ha=false
flyctl deploy -c infra/fly.workspaces.toml --ha=false
```

- [ ] **Step 4: E2E checklist** (owner auth = `Bearer $AUTH_TOKEN` from `.env.fly`, or the logged-in browser):

1. `curl https://atelier-workspaces.fly.dev/healthz` → `ok`.
2. `curl https://atelier-workspaces.fly.dev/` → 403 "not attached…".
3. Create a session from the hub (NewTask, any small public repo, a trivial task like "add a CONTRIBUTORS file").
4. Hub timeline shows cloning → setup → running and streamed assistant text; after the task, state becomes **awaiting_user** (not completed — this is the new interactive lull).
5. Click **workspace ↗** → browser lands on `atelier-workspaces.fly.dev`, brief "waking…" acceptable, then the openchamber UI loads; the chat shows the initial task's conversation; terminal and diff views work (WS endpoints proxied).
6. Send a follow-up prompt inside openchamber → agent runs; hub timeline keeps updating (bridge still relaying) and hub state flips running→awaiting_user.
7. Click **finish** in the hub → state finalizing → completed; a branch `atelier/<ts>` with the commit appears on GitHub; machine disappears (`fly machines list -a atelier-sandboxes`).
8. Idle-suspend: leave a session in awaiting_user with the workspace tab CLOSED ≥ 6 min (needs the card added; trial reaper interferes) → machine suspended, state hibernated → reopen workspace → waking page → session resumes.
9. `fly logs -a atelier-workspaces` shows no crash loops.

- [ ] **Step 5: Update docs & commit** — README "Layout" gains `apps/workspace-proxy/`; add a row to the simplifications table: cookie-routing = one workspace per browser at a time (upgrade: per-session subdomains on a custom domain). `git commit -m "docs: workspace proxy + interactive sessions"`

---

## Risks / contingencies (check during Task 7 Step 1, not after deploy)

1. **openchamber flags** — `--lan`, `--port`, `--ui-password` are documented in its README; verify against `openchamber --help` in the built image. If `--lan` doesn't exist, look for a `--hostname`/`HOST` equivalent; the requirement is binding `0.0.0.0:3000`.
2. **openchamber may refuse to run without `--ui-password`.** If so: `openchamber --lan --port 3000 --ui-password "$SESSION_TOKEN"` (the supervisor already has `SESSION_TOKEN` in env) and note in the hub UI that the workspace password is shown in the session detail (add a `workspace_password` field to `GET /sessions/:id` — but ONLY if forced; try without first).
3. **openchamber ↔ headless opencode attach**: `OPENCODE_SKIP_START=true` + `OPENCODE_HOST=http://127.0.0.1:4096` is the documented remote-attach path. If openchamber can't see the repo project, check whether it needs to be started with cwd `/workspace/repo` (add `cd "$WORKSPACE/repo"` before launching it — the supervisor is already in that directory by that point, verify order).
4. **Native deps at npm install** (node-pty, better-sqlite3, sherpa-onnx): build-essential+python3 are in the image; if sherpa-onnx (voice) fails to build, retry with `npm install -g --omit=optional` and if it's a hard dep, pin the newest `@openchamber/web` 1.x that installs clean — voice doesn't work in the firewalled VM anyway.
5. **Egress firewall vs. openchamber**: it may try to fetch avatars/models from hosts outside the allowlist; features degrade silently, that's fine. GitHub API (PRs) is already allowlisted.
6. **Trial plan**: machines die at ~5 min regardless of suspend logic. Add the credit card before judging step 8 of the e2e list.
7. **WS proxy correctness**: if openchamber's terminal connects but immediately drops, check that the upgrade handler forwards `sec-websocket-*` headers unmodified (it does — headers are passed through wholesale) and that nothing rewrites `origin`. openchamber's server may validate Origin: if terminals 403, strip the `origin` header in both proxy paths (`delete headers.origin`).

## What was deliberately NOT done (ponytail)

- No per-session subdomains / custom domain — cookie routing means one open workspace per browser; switching = click through the hub again. Upgrade when users complain.
- No openchamber settings persistence across sessions (VM-local sqlite dies with the machine). Upgrade: volume or settings-sync through the control plane.
- No multi-machine control plane, still sqlite (unchanged constraint from handoff.md).
- Local-dev workspace proxy path untested (LocalSandboxProvider has no 6PN); unit tests + Fly e2e cover it.
