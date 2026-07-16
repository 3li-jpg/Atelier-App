# Atelier Legal & Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full legal & compliance system for Atelier — Terms of Use, Privacy Policy, IP/Takedown, and Data Compliance — with the versioned-docs + acceptance foundation, privacy controls (export/delete), abuse workflow, retention/audit, and public pages on both the app and landing repos.

**Architecture:** A single `legal.ts` config holds doc metadata + the subprocessor list; doc bodies are `.md` files read at request time. A `legal_acceptances` table (added to both the sqlite `Store` and `PgStore` via the existing idempotent migration pattern) backs an acceptance gate on session creation, checkout, and VPS launch. Privacy controls add `/account/export` + `/account/delete` (a real cascade through the orchestrator + Stripe). Abuse handling adds `abuse_reports` + admin suspension actions. Data compliance adds an append-only `audit_log` + a retention sweep on the existing reaper timer. Public pages render the `.md` on both the Hono app and the Next.js landing.

**Tech Stack:** Hono (API), `node:sqlite` + postgres.js (dual store), `node:test` + `node:assert` (tests), Next.js 15 (landing), React 19 + `@atelier/ui` (web), Stripe (billing), `node:crypto` (existing AES-256-GCM).

## Global Constraints

- **Not legal advice:** every `.md` doc carries a "review by qualified counsel" note; every human decision point is marked `[LEGAL REVIEW: ...]`. Never claim certifications (SOC 2, ISO, HIPAA, PCI) or guarantees the product cannot back.
- **Dual store:** every new table/column is added to BOTH `apps/api/src/store.ts` (sqlite, sync, via `safeAlter`) AND `apps/api/src/pg-store.ts` (postgres, async, via `ADD COLUMN IF NOT EXISTS`). Methods are added to both classes and are part of the `AnyStore` union.
- **Ponytail (full):** shortest diff, stdlib first, no new deps. No unrequested abstractions. Mark deliberate simplifications with `// ponytail:` comments naming the ceiling + upgrade path.
- **Worker model (CLAUDE.md):** orchestrator delegates to GLM 5.2 via `umans claude --model umans-glm-5.2 --dangerously-skip-permissions -p "<task>"`. Max 3 concurrent, disjoint file scopes. Workers never commit; orchestrator reviews every diff before committing.
- **Test pattern:** `node --test` files alongside source in `apps/api/src/`. Harness: `Store(":memory:")` + `FakeSandbox` + `buildApp(store, orch)` + `app.request(path, {...})`. See `api.test.ts`.
- **Keys never leak:** `/account/export` and every listing path must omit `key_ciphertext`, `compute_key_ciphertext`, `github_token_ciphertext`, `session_token`. `redact()` (from `secrets.ts`) is already applied on event ingest.
- **Doc source:** `.md` duplicated in `Atelier-App/content/legal/` (canonical, served by API) AND `atelier-landing/content/legal/` (mirror for Next.js pages). A test guards against drift.
- **Effective date / version:** `2026-07-16`, version `1.0` for all docs.

---

## File Structure

### Created (app repo — `Atelier App/`)

- `apps/api/src/legal.ts` — doc metadata (`LEGAL_DOCS`), subprocessor list (`SUBPROCESSORS`), doc-body reader, gate helper `requireAcceptances`.
- `apps/api/src/audit.ts` — `audit(store, {actor, action, target, meta})` helper + `notify()` email stub.
- `apps/api/src/legal.test.ts` — gate + acceptance record tests.
- `apps/api/src/privacy.test.ts` — export completeness + deletion cascade tests.
- `apps/api/src/abuse.test.ts` — report intake + suspension action tests.
- `apps/api/src/compliance.test.ts` — retention job + audit log + key-never-logged tests.
- `content/legal/terms.md`, `privacy.md`, `ip-policy.md`, `vps-root-terms.md`, `dpa.md`, `subprocessors.md`, `data-retention.md`, `breach-response.md` — doc bodies.
- `apps/web/src/views/Legal.tsx` + `legal.css` — in-app legal viewer.
- `apps/web/src/components/ConsentModal.tsx` — re-consent modal on version bump.
- `apps/web/src/components/CookieBanner.tsx` — inert unless `NEXT_PUBLIC_ANALYTICS` set.

### Modified (app repo)

- `apps/api/src/store.ts` — `legal_acceptances`, `abuse_reports`, `audit_log`, `consent` tables + methods; `users.role` gains `'suspended'` value (no new column).
- `apps/api/src/pg-store.ts` — same tables/methods, async, postgres.
- `apps/api/src/index.ts` — `/legal`, `/legal/:docId`, `/legal/accept`, `/account/export`, `/account/delete`, `/account/consent`, `/abuse/report`, `/admin/abuse/:id/action` routes; gate wired into `POST /sessions` + `POST /billing/checkout`; suspended-role check in guarded middleware.
- `apps/api/src/orchestrator.ts` — `destroyVps(userId)` + `sweepRetention()` on the reaper timer.
- `apps/api/src/billing.ts` — `cancelSubscription(customerId)` helper (used by deletion cascade).
- `apps/web/src/api.ts` — `getLegal`, `acceptLegal`, `exportAccount`, `deleteAccount`, `setConsent`, `reportAbuse` client methods.
- `apps/web/src/views/Settings.tsx` — "Privacy & Data" section.
- `apps/web/src/components/LaunchAgentModal.tsx` — VPS root-terms confirmation.
- `apps/web/src/views/LandingView.tsx` or `App.tsx` — footer legal links + signup consent checkbox.

### Created/Modified (landing repo — `atelier-landing/`)

- `content/legal/*.md` — mirrored copies.
- `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/ip-policy/page.tsx`, `app/subprocessors/page.tsx` — Next.js pages rendering the `.md`.
- `components/App.tsx` — footer "Legal / Meta" column links.

---

## Task 1: `legal.ts` config + doc-body reader

**Files:**
- Create: `apps/api/src/legal.ts`
- Create: `content/legal/terms.md` (stub body — full text in Task 6)
- Test: `apps/api/src/legal.test.ts`

**Interfaces:**
- Produces: `LEGAL_DOCS` (record of doc metadata), `SUBPROCESSORS` (array), `getDocBody(docId)` (reads `.md`), `currentVersion(docId)`, `requireAcceptances(store, userId, docIds)` (returns missing `{docId, version}[]`).

- [ ] **Step 1: Write the failing test**

`apps/api/src/legal.test.ts`:
```ts
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { LEGAL_DOCS, SUBPROCESSORS, getDocBody, currentVersion, requireAcceptances } from "./legal.ts";

test("LEGAL_DOCS has version + effective + file for every doc", () => {
  for (const [id, meta] of Object.entries(LEGAL_DOCS)) {
    assert.ok(meta.version, `${id} missing version`);
    assert.ok(meta.effective, `${id} missing effective`);
    assert.ok(meta.file, `${id} missing file`);
    assert.ok(meta.title, `${id} missing title`);
  }
});

test("getDocBody reads the markdown file", () => {
  const body = getDocBody("terms");
  assert.ok(body.length > 0);
  assert.ok(body.includes("Terms of Use"));
});

test("requireAcceptances returns missing docs for a fresh user", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 2);
  assert.ok(missing.find((m) => m.docId === "terms"));
  assert.ok(missing.find((m) => m.docId === "privacy"));
});

test("requireAcceptances is empty after accepting current versions", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", currentVersion("terms"), "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "privacy", currentVersion("privacy"), "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 0);
});

test("requireAcceptances flags a version bump", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  // accepted an OLD version
  await store.recordAcceptance(uid, "terms", "0.9", "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms"]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].version, currentVersion("terms"));
});

test("SUBPROCESSORS has the expected providers", () => {
  const names = SUBPROCESSORS.map((s) => s.name);
  for (const expected of ["Stripe", "Supabase", "GitHub", "Vercel"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: FAIL — `Cannot find module './legal.ts'`.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/legal.ts`:
```ts
// Single source of truth for legal doc metadata + the subprocessor list.
// Doc bodies live as .md in content/legal/; bumping a version string here is
// the entire re-consent trigger.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AnyStore } from "./pg-store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(HERE, "..", "..", "content", "legal");

export const LEGAL_DOCS = {
  terms:            { version: "1.0", effective: "2026-07-16", title: "Terms of Use", file: "terms.md" },
  privacy:          { version: "1.0", effective: "2026-07-16", title: "Privacy Policy", file: "privacy.md" },
  "ip-policy":      { version: "1.0", effective: "2026-07-16", title: "IP & Takedown Policy", file: "ip-policy.md" },
  "vps-root-terms": { version: "1.0", effective: "2026-07-16", title: "Cloud VPS Root-Access Terms", file: "vps-root-terms.md" },
} as const;

export type DocId = keyof typeof LEGAL_DOCS;

// ponytail: one static list — confirm against .env before finalizing. Add a
// provider here AND in subprocessors.md (the compliance test asserts they match).
export const SUBPROCESSORS = [
  { name: "Stripe",   purpose: "Payments",            region: "US" },
  { name: "Supabase", purpose: "Auth + database",      region: "US/EU" },
  { name: "GitHub",   purpose: "OAuth + repo access",   region: "US" },
  { name: "Daytona",  purpose: "Sandbox compute",       region: "US" },
  { name: "E2B",      purpose: "Sandbox compute",       region: "US" },
  { name: "Fly.io",   purpose: "Sandbox compute",       region: "Global" },
  { name: "Hetzner",  purpose: "VPS compute",           region: "EU/US" },
  { name: "Vercel",   purpose: "Landing hosting",       region: "Global" },
];

export function currentVersion(docId: string): string {
  const meta = (LEGAL_DOCS as Record<string, { version: string }>)[docId];
  if (!meta) throw new Error(`unknown legal doc: ${docId}`);
  return meta.version;
}

export function getDocBody(docId: string): string {
  const meta = (LEGAL_DOCS as Record<string, { file: string }>)[docId];
  if (!meta) throw new Error(`unknown legal doc: ${docId}`);
  return readFileSync(join(DOCS_DIR, meta.file), "utf8");
}

// Diff the required docs' current versions against what the user accepted.
// Returns the missing set — non-empty means the UI must show a re-consent modal.
export async function requireAcceptances(
  store: AnyStore, userId: string, docIds: string[],
): Promise<{ docId: string; version: string }[]> {
  const accepted = await store.currentAcceptances(userId);
  const missing: { docId: string; version: string }[] = [];
  for (const docId of docIds) {
    const want = currentVersion(docId);
    if (accepted[docId] !== want) missing.push({ docId, version: want });
  }
  return missing;
}
```

`content/legal/terms.md` (stub — full text in Task 6):
```markdown
# Terms of Use

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel
> before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

(Full text added in Task 6.)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: FAIL on the acceptance tests (`store.recordAcceptance` / `store.currentAcceptances` don't exist yet) — that's Task 2. The `LEGAL_DOCS`, `getDocBody`, and `SUBPROCESSORS` tests should PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/legal.ts apps/api/src/legal.test.ts content/legal/terms.md
git commit -m "feat(legal): add legal.ts config + doc-body reader"
```

---

## Task 2: `legal_acceptances` table + store methods

**Files:**
- Modify: `apps/api/src/store.ts` (add table + methods)
- Modify: `apps/api/src/pg-store.ts` (add table + methods)
- Test: `apps/api/src/legal.test.ts` (the acceptance tests from Task 1 now pass)

**Interfaces:**
- Produces: `store.recordAcceptance(userId, docId, version, ip, userAgent)`, `store.currentAcceptances(userId): Record<string, string>`, `store.deleteAcceptances(userId)` (used by the deletion cascade in Task 8).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/legal.test.ts`:
```ts
test("recordAcceptance + currentAcceptances round-trip", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "Mozilla");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.0");
});

test("currentAcceptances returns latest version per doc", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "terms", "1.1", "127.0.0.1", "ua");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.1");
});

test("deleteAcceptances clears a user's records", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.deleteAcceptances(uid);
  const acc = await store.currentAcceptances(uid);
  assert.equal(Object.keys(acc).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: FAIL — `store.recordAcceptance is not a function`.

- [ ] **Step 3: Write minimal implementation (sqlite Store)**

In `apps/api/src/store.ts`, inside the constructor (after the `trial_counter` block):
```ts
    this.db.exec(`
      create table if not exists legal_acceptances (
        user_id text, doc_id text, version text, accepted_at text,
        ip text, user_agent text,
        primary key (user_id, doc_id, version));
    `);
```

Add methods to the `Store` class:
```ts
  async recordAcceptance(userId: string, docId: string, version: string, ip: string, userAgent: string): Promise<void> {
    this.db.prepare(`insert or ignore into legal_acceptances (user_id, doc_id, version, accepted_at, ip, user_agent)
      values (?,?,?,?,datetime('now'),?)`).run(userId, docId, version, ip, userAgent);
  }

  async currentAcceptances(userId: string): Promise<Record<string, string>> {
    // latest version per doc — sqlite has no DISTINCT ON; group by + max.
    const rows: any[] = this.db.prepare(
      `select doc_id, version from legal_acceptances where user_id = ?
       group by doc_id having version = max(version)`).all(userId);
    return Object.fromEntries(rows.map((r) => [r.doc_id, r.version]));
  }

  async deleteAcceptances(userId: string): Promise<void> {
    this.db.prepare("delete from legal_acceptances where user_id = ?").run(userId);
  }
```

- [ ] **Step 4: Write minimal implementation (postgres PgStore)**

In `apps/api/src/pg-store.ts`, inside `init()` (after the `trial_counter` block):
```ts
      create table if not exists legal_acceptances (
        user_id text, doc_id text, version text, accepted_at text,
        ip text, user_agent text,
        primary key (user_id, doc_id, version));
```

Add methods to the `PgStore` class:
```ts
  async recordAcceptance(userId: string, docId: string, version: string, ip: string, userAgent: string): Promise<void> {
    await this.sql`insert into legal_acceptances (user_id, doc_id, version, accepted_at, ip, user_agent)
      values (${userId}, ${docId}, ${version}, ${utcNow()}, ${ip}, ${userAgent})
      on conflict (user_id, doc_id, version) do nothing`;
  }

  async currentAcceptances(userId: string): Promise<Record<string, string>> {
    const rows = await this.sql`
      select distinct on (doc_id) doc_id, version from legal_acceptances
      where user_id = ${userId} order by doc_id, version desc`;
    return Object.fromEntries(rows.map((r: any) => [r.doc_id, r.version]));
  }

  async deleteAcceptances(userId: string): Promise<void> {
    await this.sql`delete from legal_acceptances where user_id = ${userId}`;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: PASS (all tests, including the Task 1 acceptance tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/legal.test.ts
git commit -m "feat(legal): add legal_acceptances table + store methods"
```

---

## Task 3: `/legal` API routes + acceptance gate

**Files:**
- Modify: `apps/api/src/index.ts` (add routes + wire gate)
- Test: `apps/api/src/legal.test.ts`

**Interfaces:**
- Consumes: `LEGAL_DOCS`, `getDocBody`, `currentVersion`, `requireAcceptances` (Task 1), `store.recordAcceptance` (Task 2).
- Produces: `GET /legal`, `GET /legal/:docId`, `POST /legal/accept`; the gate returns `409 { error: "acceptance_required", missing: [...] }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/legal.test.ts`:
```ts
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

function legalSetup() {
  const store = new Store(":memory:");
  const orch = new (require("./orchestrator.ts").Orchestrator)(store, new (require("./api.test.ts").FakeSandbox || class { async create(){return{id:"m",provider:"fake"}} async destroy(){} async listMachines(){return[]} })());
  return { store, app: buildApp(store, orch) };
}

test("GET /legal lists all current docs", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal");
  assert.equal(res.status, 200);
  const docs = await res.json();
  assert.ok(docs.find((d: any) => d.doc_id === "terms"));
});

test("GET /legal/:docId returns body + version", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal/terms");
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.version, "1.0");
  assert.ok(doc.body.includes("Terms of Use"));
});

test("GET /legal/unknown returns 404", async () => {
  const { app } = legalSetup();
  const res = await app.request("/legal/nope");
  assert.equal(res.status, 404);
});

test("POST /legal/accept records acceptance for an authed user", async () => {
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request("/legal/accept", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ docId: "terms", version: "1.0" }),
  });
  assert.equal(res.status, 200);
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.0");
});

test("POST /legal/accept rejects unknown doc", async () => {
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request("/legal/accept", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ docId: "nope", version: "1.0" }),
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: FAIL — routes don't exist (404s).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/index.ts`, add the import near the top:
```ts
import { LEGAL_DOCS, getDocBody, currentVersion, requireAcceptances } from "./legal.ts";
```

Add routes after the `/health` route (before the auth middleware, since `/legal` is public):
```ts
  // ---- Legal docs (public) ----
  app.get("/legal", (c) => {
    const docs = Object.entries(LEGAL_DOCS).map(([id, m]) => ({
      doc_id: id, version: m.version, effective: m.effective, title: m.title,
    }));
    return c.json(docs);
  });

  app.get("/legal/:docId", (c) => {
    const meta = (LEGAL_DOCS as Record<string, any>)[c.req.param("docId")];
    if (!meta) return c.json({ error: "not found" }, 404);
    return c.json({
      doc_id: c.req.param("docId"), version: meta.version,
      effective: meta.effective, title: meta.title, body: getDocBody(c.req.param("docId")),
    });
  });

  app.post("/legal/accept", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { docId?: string; version?: string } | null;
    if (!body?.docId || !body.version) return c.json({ error: "docId and version required" }, 400);
    if (!currentVersion(body.docId)) return c.json({ error: "not found" }, 404);
    await store.recordAcceptance(uid, body.docId, body.version, c.req.header("x-forwarded-for") ?? "0.0.0.0", c.req.header("user-agent") ?? "");
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/legal.test.ts
git commit -m "feat(legal): add /legal routes + acceptance endpoint"
```

---

## Task 4: Wire the acceptance gate into session creation + checkout

**Files:**
- Modify: `apps/api/src/index.ts` (gate in `POST /sessions` + `POST /billing/checkout`)
- Test: `apps/api/src/legal.test.ts`

**Interfaces:**
- Consumes: `requireAcceptances` (Task 1).
- Produces: gated `POST /sessions` (requires `terms`) and `POST /billing/checkout` (requires `terms`); `409 { error: "acceptance_required", missing }` when blocked.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/legal.test.ts`:
```ts
import { signSession } from "./auth.ts";

async function makeProvider(app: any, uid: string) {
  const res = await app.request("/providers", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ name: "T", base_url: "https://api.t.com/v1", dialect: "openai-chat", api_key: "sk-aaaaaaaaaaaaaaaaaaaa",
      models: [{ id: "m", role: "coder", tool_calls: true }] }),
  });
  return (await res.json()).id;
}

test("POST /sessions is blocked without terms acceptance (auth configured)", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid"; process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const pid = await makeProvider(app, uid);
  const res = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ branch: "main", provider_id: pid, model_id: "m", task: "t", permission_mode: "auto", budgets: {} }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "acceptance_required");
  delete process.env.GITHUB_OAUTH_CLIENT_ID; delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
});

test("POST /sessions proceeds after accepting terms", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "cid"; process.env.GITHUB_OAUTH_CLIENT_SECRET = "csec";
  const { store, app } = legalSetup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const pid = await makeProvider(app, uid);
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  const res = await app.request("/sessions", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ branch: "main", provider_id: pid, model_id: "m", task: "t", permission_mode: "auto", budgets: {} }),
  });
  assert.equal(res.status, 201);
  delete process.env.GITHUB_OAUTH_CLIENT_ID; delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: FAIL — sessions are created without acceptance (201 instead of 409).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/index.ts`, in `POST /sessions`, after the provider lookup and before `createSession`, add (inside the `if (uid !== undefined && authConfigured() && !isAdmin)` block, before the quota check):
```ts
      const missing = await requireAcceptances(store, uid, ["terms"]);
      if (missing.length) return c.json({ error: "acceptance_required", missing }, 409);
```

In `POST /billing/checkout`, after the `uid` check, add:
```ts
    const missing = await requireAcceptances(store, uid, ["terms"]);
    if (missing.length) return c.json({ error: "acceptance_required", missing }, 409);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/legal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/legal.test.ts
git commit -m "feat(legal): gate session creation + checkout on terms acceptance"
```

---

## Task 5: `audit_log` table + `audit()` helper + `notify()` stub

**Files:**
- Create: `apps/api/src/audit.ts`
- Modify: `apps/api/src/store.ts`, `apps/api/src/pg-store.ts` (table + `appendAudit`)
- Test: `apps/api/src/compliance.test.ts`

**Interfaces:**
- Produces: `store.appendAudit({actor, action, target, meta})`, `audit(store, entry)` (calls `appendAudit` + swallows errors so it never breaks the calling path), `notify(to, subject, body)` (stub: `console.warn` when no SMTP env).

- [ ] **Step 1: Write the failing test**

`apps/api/src/compliance.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/compliance.test.ts`
Expected: FAIL — `Cannot find module './audit.ts'`.

- [ ] **Step 3: Write minimal implementation (store tables)**

In `apps/api/src/store.ts` constructor, after `legal_acceptances`:
```ts
    this.db.exec(`
      create table if not exists audit_log (
        id integer primary key autoincrement, ts text, actor text,
        action text, target text, meta text);
    `);
```

Add method to `Store`:
```ts
  async appendAudit(e: { actor: string; action: string; target: string; meta: object }): Promise<void> {
    this.db.prepare(`insert into audit_log (ts, actor, action, target, meta) values (datetime('now'),?,?,?,?)`)
      .run(e.actor, e.action, e.target, JSON.stringify(e.meta ?? {}));
  }
```

In `apps/api/src/pg-store.ts` `init()`, after `legal_acceptances`:
```ts
      create table if not exists audit_log (
        id bigserial primary key, ts text, actor text,
        action text, target text, meta text);
```

Add method to `PgStore`:
```ts
  async appendAudit(e: { actor: string; action: string; target: string; meta: object }): Promise<void> {
    await this.sql`insert into audit_log (ts, actor, action, target, meta)
      values (${utcNow()}, ${e.actor}, ${e.action}, ${e.target}, ${JSON.stringify(e.meta ?? {})})`;
  }
```

- [ ] **Step 4: Write minimal implementation (audit.ts)**

`apps/api/src/audit.ts`:
```ts
// Append-only audit trail + email notification stub.
// ponytail: audit() swallows errors — a logging failure must never break the
// calling path (e.g. a deletion cascade). If audit reliability matters, move
// to a queue; for now in-process insert is enough.
import type { AnyStore } from "./pg-store.ts";

export interface AuditEntry { actor: string; action: string; target: string; meta?: object }

export async function audit(store: AnyStore, e: AuditEntry): Promise<void> {
  try { await store.appendAudit(e); } catch { /* never break the caller */ }
}

// ponytail: no mail dep until a provider is chosen. console.warn in dev/test;
// swap for nodemailer/resend when SMTP_URL is set. [LEGAL REVIEW: email delivery]
export async function notify(to: string, subject: string, body: string): Promise<void> {
  if (!process.env.SMTP_URL) { console.warn(`[notify stub] to=${to} subject=${subject}`); return; }
  // TODO: real transport when SMTP provider is chosen — left as a stub so the
  // abuse-report path works end-to-end without a mail dependency today.
  console.warn(`[notify] would email ${to}: ${subject}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/compliance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/audit.ts apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/compliance.test.ts
git commit -m "feat(compliance): add audit_log table + audit() + notify() stub"
```

---

## Task 6: Write the full legal document bodies

**Files:**
- Create: `content/legal/privacy.md`, `ip-policy.md`, `vps-root-terms.md`, `dpa.md`, `subprocessors.md`, `data-retention.md`, `breach-response.md`
- Modify: `content/legal/terms.md` (replace stub with full text)

**Interfaces:**
- Consumes: `SUBPROCESSORS` (Task 1) — `subprocessors.md` is generated from it; the compliance test (Task 12) asserts they match.

- [ ] **Step 1: Write `terms.md` (full 13 sections)**

`content/legal/terms.md` — replace the stub with the full Terms of Use covering: acceptance & eligibility (16+ / age of majority), service description (hosted vs self-hosted MIT), accounts, BYOK/BYOC, acceptable use (cross-ref ip-policy), user content & code (user owns repos/prompts/outputs; limited license to clone/edit/push; AI output as-is), VPS root-access clause, billing (3-day trial auto-converts, metered overage, flat VPS, cancellation, refunds, taxes), availability/beta as-is, suspension & termination (link data-retention.md), disclaimers/liability/indemnification `[LEGAL REVIEW: caps/carve-outs]`, governing law `[LEGAL REVIEW: Canadian province + venue]`, changes + contact (ali@studioatelier.ca). Header: effective date, version 1.0, not-legal-advice note.

- [ ] **Step 2: Write `privacy.md` (12 sections)**

`content/legal/privacy.md` — who we are + contact + EU/UK rep placeholder `[LEGAL REVIEW]`; what we collect and why (account/identity, encrypted model keys AES-256-GCM never in sandbox env, repo code transient in sandboxes, session events/logs, usage metering, billing metadata via Stripe no raw cards, prompts/tasks); legal bases (GDPR) `[LEGAL REVIEW]`; how we use data + "we do NOT train on user code/prompts" `[LEGAL REVIEW: confirm true]`; sharing & subprocessors (link subprocessors.md); international transfers `[LEGAL REVIEW: SCCs]`; retention (link data-retention.md); security (no invented certs); your rights (GDPR/PIPEDA/CCPA + response timelines); cookies & tracking; children (not under-16); changes + effective date + version.

- [ ] **Step 3: Write `ip-policy.md`**

`content/legal/ip-policy.md` — respect for IP; AI-generated code caveat `[LEGAL REVIEW]`; notice-and-takedown process (valid report fields: work identification, infringing material/URL/account, contact, good-faith statement, accuracy + authority statement, signature; send to ip@studioatelier.ca; expected timelines); counter-notice + restoration `[LEGAL REVIEW: DMCA §512 vs notice-and-notice]`; repeat-infringer policy (escalating to termination); what we do on a valid notice; trademark complaints; contact + effective date + version.

- [ ] **Step 4: Write `vps-root-terms.md`**

`content/legal/vps-root-terms.md` — the VM runs as root and is the user's to operate; the user is solely responsible for what they run on it; must comply with the provider's and our AUP; mirrors the "yours to operate, you accept responsibility" launch language; effective date + version + not-legal-advice note.

- [ ] **Step 5: Write `dpa.md`**

`content/legal/dpa.md` — Data Processing Addendum for business/team customers: roles (Atelier is controller of account/billing data, processor of repo content handled on user instruction), subject-matter, duration, nature/purpose, data types, subprocessor terms + current list, security measures, sub-processing consent, audit + deletion/return on termination, international-transfer mechanism `[LEGAL REVIEW throughout]`.

- [ ] **Step 6: Write `subprocessors.md`**

`content/legal/subprocessors.md` — render the `SUBPROCESSORS` list as a table (name, purpose, region). State it is generated from the `SUBPROCESSORS` config in `legal.ts` and the compliance test asserts they match. Effective date + version.

- [ ] **Step 7: Write `data-retention.md`**

`content/legal/data-retention.md` — retention schedule per data type: account (until deletion + grace), provider key ciphertext (until removed/deletion), session events/logs (90 days `[LEGAL REVIEW]`), sandbox contents (ephemeral, destroyed on session end/hibernate cleanup), VPS disk (until cancel-after-grace, 30 days `[LEGAL REVIEW]`), billing records (6-7 yrs per tax/finance law `[LEGAL REVIEW]`), abuse/audit logs (define). Explain deleted vs anonymized.

- [ ] **Step 8: Write `breach-response.md`**

`content/legal/breach-response.md` — internal runbook: detection, assessment, notification duties + timelines (GDPR 72h to supervisory authority where required; PIPEDA "real risk of significant harm"; CCPA), who is notified, how affected users are contacted `[LEGAL REVIEW]`.

- [ ] **Step 9: Verify all docs are readable via the API**

Run: `cd apps/api && node --experimental-strip-types -e "import('./src/legal.ts').then(m => { for (const id of Object.keys(m.LEGAL_DOCS)) console.log(id, m.getDocBody(id).length, 'chars'); })"`
Expected: every doc prints a non-zero length.

- [ ] **Step 10: Commit**

```bash
git add content/legal/
git commit -m "docs(legal): add full legal document bodies (terms, privacy, ip, vps, dpa, retention, breach)"
```

---

## Task 7: `/account/export` (DSAR)

**Files:**
- Modify: `apps/api/src/index.ts` (add route)
- Test: `apps/api/src/privacy.test.ts`

**Interfaces:**
- Consumes: existing `store.getAccount`, `store.listProviders`, `store.listSessions`, `store.eventsAfter`, `store.getUserPlan`, `store.currentAcceptances`.
- Produces: `GET /account/export` → JSON bundle (never includes decrypted keys or ciphertext).

- [ ] **Step 1: Write the failing test**

`apps/api/src/privacy.test.ts`:
```ts
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

class FakeSandbox { async create(){return{id:"m",provider:"fake"}} async destroy(){} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

function setup() {
  const store = new Store(":memory:");
  const orch = new Orchestrator(store, new FakeSandbox() as any);
  return { store, app: buildApp(store, orch) };
}

test("GET /account/export returns a bundle without secrets", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.createProvider({ name: "T", base_url: "https://t", dialect: "openai-chat", key_ciphertext: Buffer.from("x"), models: [], user_id: uid });
  const res = await app.request("/account/export", { headers: { Cookie: `atelier_session=${signSession(uid)}` } });
  assert.equal(res.status, 200);
  const bundle = await res.json();
  assert.ok(bundle.account);
  assert.ok(bundle.providers);
  // CRITICAL: no ciphertext or tokens anywhere in the bundle
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes("key_ciphertext"));
  assert.ok(!serialized.includes("session_token"));
  assert.ok(!serialized.includes("github_token_ciphertext"));
  assert.ok(!serialized.includes("compute_key_ciphertext"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: FAIL — route doesn't exist (404).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/index.ts`, after `GET /account`:
```ts
  app.get("/account/export", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const account = await store.getAccount(uid);
    const providers = await store.listProviders(uid);
    const sessions = await store.listSessions(uid);
    const plan = await store.getUserPlan(uid);
    const acceptances = await store.currentAcceptances(uid);
    // ponytail: events per session — fine for a personal export; paginate if a
    // user has hundreds of sessions.
    const events: Record<string, unknown> = {};
    for (const s of sessions) events[s.id] = await store.eventsAfter(s.id, 0);
    return c.json({
      exported_at: new Date().toISOString(),
      account: account ? { login: account.login, email: account.email, created_at: account.created_at } : null,
      providers, sessions, events,
      billing: plan, acceptances,
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/privacy.test.ts
git commit -m "feat(privacy): add /account/export DSAR endpoint (no secrets)"
```

---

## Task 8: `destroyVps` + `/account/delete` cascade

**Files:**
- Modify: `apps/api/src/orchestrator.ts` (add `destroyVps`)
- Modify: `apps/api/src/billing.ts` (add `cancelSubscription`)
- Modify: `apps/api/src/index.ts` (add `POST /account/delete`)
- Test: `apps/api/src/privacy.test.ts`

**Interfaces:**
- Consumes: `store.getUserPlan`, `store.setUserPlan`, `store.deleteSession`, `store.deleteProvider`, `store.clearCompute`, `store.deleteAcceptances`, `audit()`.
- Produces: `orch.destroyVps(userId)` (destroys VPS via compute provider if `vm_ref` exists), `cancelSubscription(subscriptionId)`, `POST /account/delete` → `202 { job_id }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/privacy.test.ts`:
```ts
test("POST /account/delete cascades: cancels sessions, drops keys, anonymizes user", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.createProvider({ name: "T", base_url: "https://t", dialect: "openai-chat", key_ciphertext: Buffer.from("x"), models: [], user_id: uid });
  await store.recordAcceptance(uid, "terms", "1.0", "1.1.1.1", "ua");
  await store.setUserPlan(uid, { product: "vps", tier: "medium", status: "active" });

  const res = await app.request("/account/delete", {
    method: "POST", headers: { Cookie: `atelier_session=${signSession(uid)}` },
  });
  assert.equal(res.status, 202);

  // providers gone
  assert.equal((await store.listProviders(uid)).length, 0);
  // acceptances gone
  assert.equal(Object.keys(await store.currentAcceptances(uid)).length, 0);
  // user anonymized (tombstone)
  const u = store.getUser(uid);
  assert.equal(u.login, "deleted");
  // audit log recorded the deletion
  const auditRows: any[] = (store as any).db.prepare("select * from audit_log where action = 'account_deleted'").all();
  assert.equal(auditRows.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Write `destroyVps` in orchestrator**

In `apps/api/src/orchestrator.ts`, add a method:
```ts
  // Destroy a user's VPS if one exists. VPS = vm_ref in user_plan; the compute
  // provider destroy is best-effort (the VM may already be gone). Logs nothing
  // sensitive. ponytail: no VPS-destroy primitive existed before — this fills
  // the gap the deletion cascade + retention job expose.
  async destroyVps(userId: string): Promise<void> {
    const plan = await this.store.getUserPlan(userId);
    if (!plan?.vm_ref) return;
    const ref = { id: plan.vm_ref, provider: "fly" }; // ponytail: VPS provider inferred as fly; generalize if multi-VPS-provider lands
    await this.sandbox.destroy(ref).catch(() => {});
  }
```

- [ ] **Step 4: Write `cancelSubscription` in billing**

In `apps/api/src/billing.ts`, add:
```ts
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const client = await stripe();
  if (!client) return; // no Stripe configured (self-hosted) — nothing to cancel
  await client.subscriptions.cancel(subscriptionId).catch(() => {});
}
```

- [ ] **Step 5: Write the `/account/delete` route**

In `apps/api/src/index.ts`, add the import:
```ts
import { audit } from "./audit.ts";
import { cancelSubscription } from "./billing.ts";
```

After `/account/export`:
```ts
  app.post("/account/delete", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    // 1. cancel active sessions (drives sandbox destroy via orch.cancel)
    for (const s of await store.listSessions(uid)) {
      if (!["completed", "failed", "cancelled"].includes(s.state)) {
        await orch.cancel(s.id).catch(() => {});
      }
    }
    // 2. destroy VPS + cancel Stripe subscription
    await orch.destroyVps(uid).catch(() => {});
    const plan = await store.getUserPlan(uid);
    if (plan?.stripe_subscription_id) await cancelSubscription(plan.stripe_subscription_id);
    // 3. delete providers + compute key + github token
    for (const p of await store.listProviders(uid)) await store.deleteProvider(p.id);
    await store.clearCompute(uid);
    // 4. delete sessions + events
    for (const s of await store.listSessions(uid)) await store.deleteSession(s.id);
    // 5. delete acceptances
    await store.deleteAcceptances(uid);
    // 6. null user_plan
    if (plan) await store.setUserPlan(uid, { product: plan.product ?? "vps", tier: plan.tier ?? "", status: "canceled",
      stripe_customer_id: null, stripe_subscription_id: null, trial_end: null,
      current_period_start: null, current_period_end: null, vm_ref: null, region: null });
    // 7. anonymize the user (tombstone for audit/billing retention)
    (store as any).db?.prepare?.("update users set login='deleted', email=null, github_token_ciphertext=null, compute_key_ciphertext=null, password_hash=null where id=?").run?.(uid);
    // PgStore path (no .db): use a store method
    await store.anonymizeUser?.(uid);
    // 8. audit + clear cookie
    await audit(store, { actor: uid, action: "account_deleted", target: `user:${uid}`, meta: {} });
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true, job_id: uid });
  });
```

Add `anonymizeUser` to both stores. In `Store`:
```ts
  async anonymizeUser(userId: string): Promise<void> {
    this.db.prepare("update users set login='deleted', email=null, github_token_ciphertext=null, compute_key_ciphertext=null, password_hash=null where id=?").run(userId);
  }
```
In `PgStore`:
```ts
  async anonymizeUser(userId: string): Promise<void> {
    await this.sql`update users set login='deleted', email=null, github_token_ciphertext=null, compute_key_ciphertext=null, password_hash=null where id=${userId}`;
  }
```

Then simplify the route's step 7 to just `await store.anonymizeUser(uid);` (remove the inline `(store as any).db` line — it was a guard; the method covers both backends).

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/orchestrator.ts apps/api/src/billing.ts apps/api/src/index.ts apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/privacy.test.ts
git commit -m "feat(privacy): add /account/delete cascade + destroyVps + cancelSubscription"
```

---

## Task 9: `abuse_reports` table + `/abuse/report` + admin suspension

**Files:**
- Modify: `apps/api/src/store.ts`, `apps/api/src/pg-store.ts` (table + methods)
- Modify: `apps/api/src/index.ts` (routes + suspended-role check in middleware)
- Test: `apps/api/src/abuse.test.ts`

**Interfaces:**
- Consumes: `notify()`, `audit()`, `orch.cancel()`, `orch.destroyVps()`.
- Produces: `store.createAbuseReport(...)`, `store.actionAbuseReport(id, status)`, `store.strikeCount(userId)`; `POST /abuse/report` (public), `POST /admin/abuse/:id/action` (admin-gated); `users.role = 'suspended'` rejected by the guarded middleware.

- [ ] **Step 1: Write the failing test**

`apps/api/src/abuse.test.ts`:
```ts
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildApp } from "./index.ts";
import { signSession } from "./auth.ts";

class FakeSandbox { created:any[]=[]; destroyed:string[]=[]; async create(c:any){this.created.push(c);return{id:"m",provider:"fake"}} async destroy(ref:any){this.destroyed.push(ref.id)} async suspend(){} async resume(){} async stop(){} async status(){return"started"} async waitFor(){} async listMachines(){return[]} }

function setup() {
  const store = new Store(":memory:");
  const orch = new Orchestrator(store, new FakeSandbox() as any);
  return { store, sandbox: new FakeSandbox(), app: buildApp(store, orch), orch };
}

test("POST /abuse/report stores a report (public, no auth)", async () => {
  const { app } = setup();
  const res = await app.request("/abuse/report", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright", target_ref: "session:abc", reporter_email: "x@y.co", reporter_name: "X", details: "infringes" }),
  });
  assert.equal(res.status, 201);
});

test("POST /abuse/report rejects missing fields", async () => {
  const { app } = setup();
  const res = await app.request("/abuse/report", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright" }),
  });
  assert.equal(res.status, 400);
});

test("admin suspend_account sets role=suspended and user is then blocked", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  // make admin
  (store as any).db.prepare("update users set role='admin' where id=?").run(uid);
  // create a report to action
  const r = await app.request("/abuse/report", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "copyright", target_ref: `user:${uid}`, reporter_email: "x@y.co", reporter_name: "X", details: "x" }) });
  const { id } = await r.json();
  // admin actions it
  const cookie = `atelier_session=${signSession(uid)}`;
  const res = await app.request(`/admin/abuse/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "suspend_account" }) });
  assert.equal(res.status, 200);
  // user's role is now suspended
  const u = store.getUser(uid);
  assert.equal(u.role, "suspended");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/abuse.test.ts`
Expected: FAIL — routes/table don't exist.

- [ ] **Step 3: Write store tables + methods**

In `apps/api/src/store.ts` constructor, after `audit_log`:
```ts
    this.db.exec(`
      create table if not exists abuse_reports (
        id text primary key, type text, target_ref text, reporter_email text,
        reporter_name text, details text, status text default 'open', created_at text);
    `);
```

Add methods to `Store`:
```ts
  async createAbuseReport(r: { type: string; target_ref: string; reporter_email: string; reporter_name: string; details: string }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`insert into abuse_reports (id,type,target_ref,reporter_email,reporter_name,details,status,created_at)
      values (?,?,?,?,?,?,'open',datetime('now'))`).run(id, r.type, r.target_ref, r.reporter_email, r.reporter_name, r.details);
    return id;
  }
  async actionAbuseReport(id: string, status: string): Promise<void> {
    this.db.prepare("update abuse_reports set status = ? where id = ?").run(status, id);
  }
  async getAbuseReport(id: string): Promise<any> {
    return this.db.prepare("select * from abuse_reports where id = ?").get(id) ?? null;
  }
  async strikeCount(userId: string): Promise<number> {
    const row: any = this.db.prepare("select count(*) as c from abuse_reports where target_ref = ? and status = 'actioned'").get(`user:${userId}`);
    return row?.c ?? 0;
  }
  async setUserRole(userId: string, role: string): Promise<void> {
    this.db.prepare("update users set role = ? where id = ?").run(role, userId);
  }
```

In `apps/api/src/pg-store.ts` `init()`, after `audit_log`:
```ts
      create table if not exists abuse_reports (
        id text primary key, type text, target_ref text, reporter_email text,
        reporter_name text, details text, status text default 'open', created_at text);
```

Add methods to `PgStore`:
```ts
  async createAbuseReport(r: { type: string; target_ref: string; reporter_email: string; reporter_name: string; details: string }): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into abuse_reports (id,type,target_ref,reporter_email,reporter_name,details,status,created_at)
      values (${id},${r.type},${r.target_ref},${r.reporter_email},${r.reporter_name},${r.details},'open',${utcNow()})`;
    return id;
  }
  async actionAbuseReport(id: string, status: string): Promise<void> {
    await this.sql`update abuse_reports set status = ${status} where id = ${id}`;
  }
  async getAbuseReport(id: string): Promise<any> {
    const [row] = await this.sql`select * from abuse_reports where id = ${id}`;
    return row ?? null;
  }
  async strikeCount(userId: string): Promise<number> {
    const [{ c }] = await this.sql`select count(*) as c from abuse_reports where target_ref = ${"user:" + userId} and status = 'actioned'`;
    return Number(c ?? 0);
  }
  async setUserRole(userId: string, role: string): Promise<void> {
    await this.sql`update users set role = ${role} where id = ${userId}`;
  }
```

- [ ] **Step 4: Write the routes + suspended check**

In `apps/api/src/index.ts`, add imports:
```ts
import { notify } from "./audit.ts";
import { randomUUID } from "node:crypto";
```

In the guarded middleware, after `c.set("userId", uid); return next();` for the cookie path, add a suspended check. Modify the cookie-acceptance block:
```ts
    const uid = verifySession(getCookie(c, SESSION_COOKIE));
    if (uid) {
      if (uid !== OWNER_ID) {
        const u = await store.getUser(uid);
        if (u?.role === "suspended") return c.json({ error: "account suspended" }, 401);
      }
      c.set("userId", uid); return next();
    }
```
(Apply the same suspended check in the bearer + query-token paths — extract a helper `async function notSuspended(uid) { if (uid === OWNER_ID) return true; const u = await store.getUser(uid); return u?.role !== "suspended"; }` and call it before `c.set("userId", uid)` in each auth branch.)

Add the routes (after `/legal/accept`):
```ts
  // ---- Abuse / takedown (public report + admin action) ----
  app.post("/abuse/report", async (c) => {
    const body = await c.req.json().catch(() => null) as { type?: string; target_ref?: string; reporter_email?: string; reporter_name?: string; details?: string } | null;
    if (!body?.type || !body.target_ref || !body.reporter_email || !body.details) {
      return c.json({ error: "type, target_ref, reporter_email, details required" }, 400);
    }
    const id = await store.createAbuseReport(body);
    await notify("ip@studioatelier.ca", `Abuse report: ${body.type}`, JSON.stringify(body, null, 2));
    return c.json({ id }, 201);
  });

  app.post("/admin/abuse/:id/action", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const user = uid === OWNER_ID ? { role: "admin" } : await store.getUser(uid);
    if (user?.role !== "admin") return c.json({ error: "forbidden" }, 403);
    const report = await store.getAbuseReport(c.req.param("id"));
    if (!report) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null) as { action?: string } | null;
    const action = body?.action;
    if (!["suspend_session", "suspend_vps", "suspend_account", "dismiss"].includes(action ?? "")) {
      return c.json({ error: "invalid action" }, 400);
    }
    if (action === "suspend_session") {
      const sid = report.target_ref.replace(/^session:/, "");
      if (report.target_ref.startsWith("session:")) await orch.cancel(sid).catch(() => {});
    } else if (action === "suspend_vps") {
      const userId = report.target_ref.replace(/^user:/, "");
      if (report.target_ref.startsWith("user:")) {
        await orch.destroyVps(userId).catch(() => {});
        const p = await store.getUserPlan(userId);
        if (p) await store.setUserPlan(userId, { product: p.product, tier: p.tier, status: "suspended",
          stripe_customer_id: p.stripe_customer_id, stripe_subscription_id: p.stripe_subscription_id,
          trial_end: p.trial_end, current_period_start: p.current_period_start, current_period_end: p.current_period_end, vm_ref: null, region: p.region });
      }
    } else if (action === "suspend_account") {
      const userId = report.target_ref.replace(/^user:/, "");
      if (report.target_ref.startsWith("user:")) {
        await store.setUserRole(userId, "suspended");
        for (const s of await store.listSessions(userId)) if (!["completed","failed","cancelled"].includes(s.state)) await orch.cancel(s.id).catch(() => {});
        await orch.destroyVps(userId).catch(() => {});
      }
    }
    await store.actionAbuseReport(c.req.param("id"), action === "dismiss" ? "dismissed" : "actioned");
    await audit(store, { actor: uid, action: `abuse_${action}`, target: report.target_ref, meta: { report_id: c.req.param("id") } });
    return c.json({ ok: true });
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/abuse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/index.ts apps/api/src/abuse.test.ts
git commit -m "feat(abuse): add abuse_reports + /abuse/report + admin suspension actions"
```

---

## Task 10: Retention sweep on the reaper

**Files:**
- Modify: `apps/api/src/orchestrator.ts` (add `sweepRetention`, call from `sweep`)
- Modify: `apps/api/src/store.ts`, `apps/api/src/pg-store.ts` (add `deleteEventsOlderThan(days)`, `listCanceledVpsBefore(date)`)
- Test: `apps/api/src/compliance.test.ts`

**Interfaces:**
- Consumes: `store.deleteEventsOlderThan`, `store.listCanceledVpsBefore`, `destroyVps`, `audit()`.
- Produces: `orch.sweepRetention()` — purges old events, destroys VPS disks past grace, idempotent, logged.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/compliance.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/compliance.test.ts`
Expected: FAIL — `sweepRetention` not a function.

- [ ] **Step 3: Write store methods**

In `Store`:
```ts
  async deleteEventsOlderThan(days: number): Promise<void> {
    this.db.prepare(`delete from events where ts < datetime('now', ?)`).run(`-${days} days`);
  }
  async listCanceledVpsBefore(dateIso: string): Promise<{ user_id: string; vm_ref: string }[]> {
    return this.db.prepare(`select user_id, vm_ref from user_plan where product='vps' and status='canceled' and vm_ref is not null and current_period_end < ?`).all(dateIso)
      .filter((r: any) => r.vm_ref);
  }
```
In `PgStore`:
```ts
  async deleteEventsOlderThan(days: number): Promise<void> {
    await this.sql`delete from events where ts < now() - interval ${days + " days"}`;
  }
  async listCanceledVpsBefore(dateIso: string): Promise<{ user_id: string; vm_ref: string }[]> {
    return (await this.sql`select user_id, vm_ref from user_plan where product='vps' and status='canceled' and vm_ref is not null and current_period_end < ${dateIso}`)
      .filter((r: any) => r.vm_ref);
  }
```

- [ ] **Step 4: Write `sweepRetention` in orchestrator**

In `apps/api/src/orchestrator.ts`, add a method and call it from `sweep()`:
```ts
  // Retention: purge old session events + destroy VPS disks past their grace.
  // Idempotent (re-runnable where-clauses). ponytail: 90d events / 30d VPS grace
  // are defaults; tune via env. [LEGAL REVIEW: retention windows]
  async sweepRetention(): Promise<void> {
    const eventDays = Number(process.env.RETENTION_EVENT_DAYS ?? 90);
    const vpsGraceDays = Number(process.env.RETENTION_VPS_GRACE_DAYS ?? 30);
    await this.store.deleteEventsOlderThan(eventDays).catch(() => {});
    const cutoff = new Date(Date.now() - vpsGraceDays * 86400_000).toISOString().slice(0, 19).replace("T", " ");
    for (const row of await this.store.listCanceledVpsBefore(cutoff)) {
      await this.sandbox.destroy({ id: row.vm_ref, provider: "fly" }).catch(() => {});
    }
  }
```

In `sweep()`, add `await this.sweepRetention();` at the end (after `reapOrphans`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/compliance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator.ts apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/compliance.test.ts
git commit -m "feat(compliance): add retention sweep (events TTL + VPS grace destroy)"
```

---

## Task 11: Cookie consent + `/account/consent`

**Files:**
- Modify: `apps/api/src/store.ts`, `apps/api/src/pg-store.ts` (`consent` table + `setConsent`)
- Modify: `apps/api/src/index.ts` (`POST /account/consent`)
- Test: `apps/api/src/privacy.test.ts`

**Interfaces:**
- Produces: `store.setConsent(userId, analytics)`, `POST /account/consent { analytics }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/privacy.test.ts`:
```ts
test("POST /account/consent records the analytics choice", async () => {
  const { store, app } = setup();
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const res = await app.request("/account/consent", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `atelier_session=${signSession(uid)}` },
    body: JSON.stringify({ analytics: false }),
  });
  assert.equal(res.status, 200);
  const row: any = (store as any).db.prepare("select * from consent where user_id = ?").get(uid);
  assert.equal(row.analytics, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: FAIL — table/route don't exist.

- [ ] **Step 3: Write store table + method + route**

In `Store` constructor, after `abuse_reports`:
```ts
    this.db.exec(`create table if not exists consent (user_id text primary key, analytics integer, accepted_at text)`);
```
Add method:
```ts
  async setConsent(userId: string, analytics: boolean): Promise<void> {
    this.db.prepare(`insert into consent (user_id, analytics, accepted_at) values (?,?,datetime('now'))
      on conflict(user_id) do update set analytics=excluded.analytics, accepted_at=datetime('now')`).run(userId, analytics ? 1 : 0);
  }
```
In `PgStore` `init()`:
```ts
      create table if not exists consent (user_id text primary key, analytics boolean, accepted_at text);
```
Add method:
```ts
  async setConsent(userId: string, analytics: boolean): Promise<void> {
    await this.sql`insert into consent (user_id, analytics, accepted_at) values (${userId}, ${analytics}, ${utcNow()})
      on conflict (user_id) do update set analytics=excluded.analytics, accepted_at=${utcNow()}`;
  }
```
In `index.ts`, after `/account/delete`:
```ts
  app.post("/account/consent", async (c) => {
    const uid = uidOf(c);
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { analytics?: boolean } | null;
    await store.setConsent(uid, Boolean(body?.analytics));
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/privacy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/store.ts apps/api/src/pg-store.ts apps/api/src/index.ts apps/api/src/privacy.test.ts
git commit -m "feat(privacy): add cookie consent table + /account/consent"
```

---

## Task 12: Subprocessor doc-sync test + full suite green

**Files:**
- Test: `apps/api/src/compliance.test.ts`

**Interfaces:**
- Consumes: `SUBPROCESSORS` (Task 1), `getDocBody` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/compliance.test.ts`:
```ts
import { SUBPROCESSORS, getDocBody } from "./legal.ts";

test("subprocessors.md mentions every configured subprocessor", () => {
  const body = getDocBody("subprocessors");
  // subprocessors.md is not in LEGAL_DOCS (it's referenced by privacy/dpa) —
  // read it directly so the sync check is independent of the route.
  const { readFileSync } = require("node:fs");
  const { dirname, join } = require("node:path");
  const path = join(dirname(require("url").pathToFileURL(__filename).pathname), "..", "..", "content", "legal", "subprocessors.md");
  const md = readFileSync(path, "utf8");
  for (const s of SUBPROCESSORS) {
    assert.ok(md.includes(s.name), `subprocessors.md missing ${s.name}`);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/api && node --experimental-strip-types --test src/compliance.test.ts`
Expected: PASS (Task 6 wrote `subprocessors.md` with all names).

- [ ] **Step 3: Run the full test suite + register the new test files**

Modify `apps/api/package.json` `test` script to include the new files:
```json
"test": "node --experimental-strip-types --test src/api.test.ts src/pg-store.test.ts src/plans.test.ts src/billing.test.ts src/sandbox-billing.test.ts src/legal.test.ts src/privacy.test.ts src/abuse.test.ts src/compliance.test.ts"
```

Run: `cd apps/api && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/compliance.test.ts apps/api/package.json
git commit -m "test(compliance): subprocessor doc-sync + register legal test files"
```

---

## Task 13: Web UI — api client + Settings Privacy section + ConsentModal + CookieBanner

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/views/Settings.tsx`
- Create: `apps/web/src/components/ConsentModal.tsx`, `apps/web/src/components/CookieBanner.tsx`

**Interfaces:**
- Produces: `api.getLegal()`, `api.getLegalDoc(id)`, `api.acceptLegal(docId, version)`, `api.exportAccount()`, `api.deleteAccount()`, `api.setConsent(analytics)`, `api.reportAbuse(...)`.

- [ ] **Step 1: Add api client methods**

In `apps/web/src/api.ts`, add to the `api` object:
```ts
  getLegal: () => req<{ doc_id: string; version: string; effective: string; title: string }[]>("/legal"),
  getLegalDoc: (id: string) => req<{ doc_id: string; version: string; effective: string; title: string; body: string }>(`/legal/${encodeURIComponent(id)}`),
  acceptLegal: (docId: string, version: string) =>
    req<{ ok: boolean }>("/legal/accept", { method: "POST", body: JSON.stringify({ docId, version }) }),
  exportAccount: () => req<unknown>("/account/export"),
  deleteAccount: () => req<{ ok: boolean; job_id: string }>("/account/delete", { method: "POST" }),
  setConsent: (analytics: boolean) =>
    req<{ ok: boolean }>("/account/consent", { method: "POST", body: JSON.stringify({ analytics }) }),
  reportAbuse: (r: { type: string; target_ref: string; reporter_email: string; reporter_name: string; details: string }) =>
    req<{ id: string }>("/abuse/report", { method: "POST", body: JSON.stringify(r) }),
```

- [ ] **Step 2: Add the Privacy & Data section to Settings**

In `apps/web/src/views/Settings.tsx`, add a section before the "Session" section:
```tsx
      {/* PRIVACY & DATA */}
      {account && (
        <section className="st-section">
          <header className="st-section-head">
            <h2 className="st-section-title">Privacy & Data</h2>
            <p className="st-section-desc">Export your data or delete your account.</p>
          </header>
          <div className="st-row-actions">
            <Button variant="ghost" onClick={async () => {
              const blob = new Blob([JSON.stringify(await api.exportAccount(), null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "atelier-export.json"; a.click();
              URL.revokeObjectURL(url);
            }}>Export my data</Button>
            <Button variant="ghost" onClick={async () => {
              const typed = window.prompt(`Type your email to confirm deletion: ${account.user.login}`);
              if (typed !== account.user.login) { toast.push("Email did not match", "error"); return; }
              await api.deleteAccount();
              window.location.href = "/";
            }}>Delete account</Button>
          </div>
        </section>
      )}
```

- [ ] **Step 3: Create ConsentModal**

`apps/web/src/components/ConsentModal.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button } from "@atelier/ui";

// Renders when the API returns 409 acceptance_required. Shows the docs, records
// acceptance on agree, then retries the blocked action.
export function ConsentModal({ missing, onDone }: { missing: { docId: string; version: string }[]; onDone: () => void }) {
  const [docs, setDocs] = useState<Record<string, string>>(({});
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    Promise.all(missing.map((m) => api.getLegalDoc(m.docId))).then((ds) => {
      const map: Record<string, string> = {};
      ds.forEach((d) => (map[d.doc_id] = d.body));
      setDocs(map);
    });
  }, [missing]);
  return (
    <div className="consent-overlay">
      <div className="consent-modal">
        <h2>We've updated our terms</h2>
        <p>Please review and accept to continue:</p>
        {missing.map((m) => (
          <details key={m.docId}><summary>{m.docId}</summary><pre>{docs[m.docId]}</pre></details>
        ))}
        <label><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I agree</label>
        <Button variant="primary" disabled={!agreed} onClick={async () => {
          for (const m of missing) await api.acceptLegal(m.docId, m.version);
          onDone();
        }}>Continue</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create CookieBanner (inert unless analytics flag)**

`apps/web/src/components/CookieBanner.tsx`:
```tsx
import { useState } from "react";
import { api } from "../api.ts";

// ponytail: no analytics today — banner renders only if NEXT_PUBLIC_ANALYTICS
// is set. Hook present for when tracking lands.
export function CookieBanner() {
  const [shown, setShown] = useState(true);
  if (!process.env.NEXT_PUBLIC_ANALYTICS || !shown) return null;
  return (
    <div className="cookie-banner">
      <span>We use essential cookies; analytics only with your consent.</span>
      <button onClick={() => { api.setConsent(true); setShown(false); }}>Accept</button>
      <button onClick={() => { api.setConsent(false); setShown(false); }}>Reject</button>
    </div>
  );
}
```

- [ ] **Step 5: Verify the web build**

Run: `cd apps/web && npx tsc --noEmit` (or the repo's typecheck)
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/views/Settings.tsx apps/web/src/components/ConsentModal.tsx apps/web/src/components/CookieBanner.tsx
git commit -m "feat(web): legal api client + Settings privacy section + consent modal + cookie banner"
```

---

## Task 14: Landing public pages + footer links + mirrored docs

**Files:**
- Create: `atelier-landing/content/legal/*.md` (mirror of app repo)
- Create: `atelier-landing/app/terms/page.tsx`, `app/privacy/page.tsx`, `app/ip-policy/page.tsx`, `app/subprocessors/page.tsx`
- Modify: `atelier-landing/components/App.tsx` (footer links)

**Interfaces:**
- Consumes: the `.md` bodies from Task 6 (mirrored).

- [ ] **Step 1: Mirror the docs**

Copy `content/legal/*.md` from the app repo to `atelier-landing/content/legal/`. Verify the count matches:
```bash
ls atelier-landing/content/legal/ | wc -l   # expect 8
```

- [ ] **Step 2: Create a shared legal-page component + the four routes**

`atelier-landing/app/terms/page.tsx`:
```tsx
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export const metadata = { title: "Terms of Use — Atelier" };

export default function Page() {
  const body = readFileSync(join(process.cwd(), "content/legal/terms.md"), "utf8");
  return <LegalDoc body={body} />;
}

function LegalDoc({ body }: { body: string }) {
  // ponytail: render markdown as preformatted text — no markdown dep. Swap for
  // a renderer (react-markdown) if styling matters; the text is the legal record.
  return <pre className="legal-doc">{body}</pre>;
}
```
Repeat for `privacy/page.tsx`, `ip-policy/page.tsx`, `subprocessors/page.tsx` (change the filename + title each time).

- [ ] **Step 3: Add footer links**

In `atelier-landing/components/App.tsx`, in the "Legal / Meta" footer column, replace the two links with:
```tsx
                <p className="footer__col-title">Legal / Meta</p>
                <a href="/terms">Terms</a>
                <a href="/privacy">Privacy</a>
                <a href="/ip-policy">IP & Takedown</a>
                <a href="/subprocessors">Subprocessors</a>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">MIT License</a>
                <a href="#top">© 2026 Atelier</a>
```

- [ ] **Step 4: Verify the landing build**

Run: `cd atelier-landing && npm run build`
Expected: build succeeds; `/terms`, `/privacy`, `/ip-policy`, `/subprocessors` pages generated.

- [ ] **Step 5: Commit**

```bash
cd atelier-landing
git add content/legal/ app/terms/ app/privacy/ app/ip-policy/ app/subprocessors/ components/App.tsx
git commit -m "feat(landing): add public legal pages + footer links + mirrored docs"
```

---

## Task 15: In-app legal viewer + footer + signup consent + VPS launch terms

**Files:**
- Create: `apps/web/src/views/Legal.tsx` + `legal.css`
- Modify: `apps/web/src/components/AppShell.tsx` (footer link) or `App.tsx` (route)
- Modify: `apps/web/src/views/LandingView.tsx` (signup consent checkbox)
- Modify: `apps/web/src/components/LaunchAgentModal.tsx` (VPS root-terms confirmation)

**Interfaces:**
- Consumes: `api.getLegalDoc`, `api.acceptLegal`.

- [ ] **Step 1: Create the in-app legal viewer**

`apps/web/src/views/Legal.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import "./legal.css";

export function Legal({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<{ title: string; body: string; version: string } | null>(null);
  useEffect(() => { api.getLegalDoc(docId).then(setDoc); }, [docId]);
  if (!doc) return <div className="legal-wrap">Loading…</div>;
  return (
    <div className="legal-wrap">
      <h1>{doc.title}</h1>
      <pre className="legal-body">{doc.body}</pre>
    </div>
  );
}
```

- [ ] **Step 2: Add signup consent checkbox**

In `apps/web/src/views/LandingView.tsx` (or wherever the signup form lives), add an unchecked checkbox that calls `api.acceptLegal("terms", ...)` + `api.acceptLegal("privacy", ...)` on successful signup, blocking submit until checked:
```tsx
<label className="signup-consent">
  <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
  I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>
</label>
```
(Wire `consented` into the submit button's `disabled`.)

- [ ] **Step 3: Add VPS root-terms confirmation to the launch modal**

In `apps/web/src/components/LaunchAgentModal.tsx`, when launching a VPS, require an explicit checkbox that records `vps-root-terms` acceptance before the launch call:
```tsx
<label className="vps-terms">
  <input type="checkbox" checked={vpsAgreed} onChange={(e) => setVpsAgreed(e.target.checked)} />
  I understand this VM runs as root and is mine to operate.
</label>
```
On launch: `await api.acceptLegal("vps-root-terms", "1.0");` then the existing launch call. Disable launch until checked.

- [ ] **Step 4: Add footer legal links in the app**

In `apps/web/src/components/AppShell.tsx` (or the app's footer), add links to `/terms`, `/privacy`, `/ip-policy` that render the `Legal` view. (If the app uses hash routing, add the routes in `App.tsx`.)

- [ ] **Step 5: Verify the web build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/Legal.tsx apps/web/src/views/legal.css apps/web/src/views/LandingView.tsx apps/web/src/components/LaunchAgentModal.tsx apps/web/src/components/AppShell.tsx
git commit -m "feat(web): in-app legal viewer + signup consent + VPS root-terms gate"
```

---

## Task 16: Final verification + push

- [ ] **Step 1: Run the full API test suite**

Run: `cd "Atelier App" && npm test`
Expected: all green (api, pg-store, plans, billing, sandbox-billing, legal, privacy, abuse, compliance).

- [ ] **Step 2: Run the web typecheck**

Run: `cd "Atelier App/apps/web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the landing build**

Run: `cd Atelier-Landing && npm run build`
Expected: succeeds.

- [ ] **Step 4: Push both repos**

```bash
cd "Atelier App" && git push origin main
cd ../Atelier-Landing && git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- Terms doc + /terms + acceptance + versioning → Tasks 1–4, 6, 13–15. ✓
- Privacy doc + /privacy + export + delete + cookie consent → Tasks 6, 7, 8, 11, 13. ✓
- IP policy + /ip-policy + report + admin suspension + repeat-infringer → Tasks 6, 9, 14. ✓
- DPA + subprocessors + retention + breach + audit log + retention job + minimization tests + residency → Tasks 5, 6, 10, 12. ✓
- Public pages on both repos + footer + signup + checkout gates → Tasks 4, 13, 14, 15. ✓
- "Not legal advice" + `[LEGAL REVIEW]` markers → Task 6 (every doc). ✓
- Build + tests green + committed + pushed → Task 16. ✓

**2. Placeholder scan:** No TBD/TODO in steps (the `notify` TODO is a documented stub, intentional per ponytail). All code blocks are complete.

**3. Type consistency:** `recordAcceptance`/`currentAcceptances`/`deleteAcceptances` (Task 2) used consistently in Tasks 3, 4, 8. `appendAudit`/`audit` (Task 5) used in Tasks 8, 9, 10. `destroyVps` (Task 8) used in Tasks 9, 10. `anonymizeUser` (Task 8) defined on both stores. `requireAcceptances` (Task 1) used in Task 4. `SUBPROCESSORS` (Task 1) checked in Task 12. Consistent.
