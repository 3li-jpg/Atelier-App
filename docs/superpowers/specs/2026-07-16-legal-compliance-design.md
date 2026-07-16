# Atelier Legal & Compliance — Design

**Date:** 2026-07-16
**Scope:** All four prompts — Terms of Use, Privacy Policy, IP/Takedown, Data Compliance — built in one session.
**Status:** Draft for implementation.

> Not legal advice. Every doc carries a "review by qualified counsel" note and `[LEGAL REVIEW: ...]` markers at each human decision point. No certifications (SOC 2, ISO, HIPAA, PCI) or guarantees are claimed that the product cannot back.

## Decisions (locked)

- **Scope:** all four prompts in one session.
- **Doc source:** duplicate `.md` in both repos. Canonical in `Atelier-App/content/legal/*.md` (served by the API); a checked-in mirror in `atelier-landing/content/legal/` for the Next.js public pages. No cross-repo fetch at runtime. A test guards against drift.

## Verified code facts (ground the design in reality)

- **Dual store:** `Store` (sqlite, sync) + `PgStore` (postgres, async), union `AnyStore`. Both use idempotent migrations — `safeAlter` (sqlite) and `ADD COLUMN IF NOT EXISTS` (pg). New tables/columns follow this pattern.
- **Keys:** `encryptKey`/`decryptKey` = AES-256-GCM under a single `MASTER_KEY` (`secrets.ts`). Sealed-box handshake delivers secrets to the sandbox; keys never enter machine env.
- **Auth:** stateless HMAC session cookies (`auth.ts`) — **no server-side revocation** (noted in code). `OWNER_ID = "owner"`; admin = `users.role === 'admin'`. Guarded middleware pattern in `index.ts`.
- **Billing:** Stripe checkout, 3-day trial, `user_plan` table. `billing.ts` webhook handlers set status; `onSubscriptionDeleted` nulls `vm_ref`.
- **VPS gap:** VPS = `vm_ref` in `user_plan`. The orchestrator has sandbox `destroy`/`reap` but **no VPS-destroy primitive** — `onSubscriptionDeleted` only nulls the ref. The deletion cascade and retention job expose this; a `destroyVps(userId)` path is added.
- **Greenfield:** no `legal.ts`, no `legal_acceptances`/`abuse_reports`/`audit_log` tables, no `/legal`, `/account/export`, `/account/delete`, `/abuse/report`, `/admin/abuse` routes, no retention job, no landing footer legal links.

## Worker model (per CLAUDE.md)

Orchestrator delegates implementation to GLM 5.2 via `umans claude --model umans-glm-5.2 --dangerously-skip-permissions -p "<task>"`. Max 3 concurrent, disjoint file scopes, orchestrator reviews every diff before committing. Workers never commit.

---

## Section 1 — Shared legal foundation (Prompt 1 core)

### `apps/api/src/legal.ts`

Single source of truth for doc metadata + subprocessor list:

```ts
export const LEGAL_DOCS = {
  terms:            { version: "1.0", effective: "2026-07-16", title: "Terms of Use", file: "terms.md" },
  privacy:          { version: "1.0", effective: "2026-07-16", title: "Privacy Policy", file: "privacy.md" },
  "ip-policy":      { version: "1.0", effective: "2026-07-16", title: "IP & Takedown Policy", file: "ip-policy.md" },
  "vps-root-terms": { version: "1.0", effective: "2026-07-16", title: "Cloud VPS Root-Access Terms", file: "vps-root-terms.md" },
} as const;

export const SUBPROCESSORS = [
  { name: "Stripe",     purpose: "Payments",            region: "US" },
  { name: "Supabase",   purpose: "Auth + database",      region: "US/EU" },
  { name: "GitHub",     purpose: "OAuth + repo access",   region: "US" },
  { name: "Daytona",    purpose: "Sandbox compute",       region: "US" },
  { name: "E2B",        purpose: "Sandbox compute",       region: "US" },
  { name: "Fly.io",     purpose: "Sandbox compute",       region: "Global" },
  { name: "Hetzner",    purpose: "VPS compute",           region: "EU/US" },
  { name: "Vercel",     purpose: "Landing hosting",       region: "Global" },
  // user's chosen model provider — operates under the user's own key
];
```

Doc bodies are `.md` in `content/legal/`, read at request time (no build step). Bumping a `version` string is the entire re-consent trigger.

### `legal_acceptances` table (both backends)

`user_id, doc_id, version, accepted_at, ip, user_agent`. PK `(user_id, doc_id, version)`.

### Store methods (added to `Store` + `PgStore`, on `AnyStore`)

- `recordAcceptance(userId, docId, version, ip, userAgent)`
- `hasAccepted(userId, docId, version): boolean`
- `currentAcceptances(userId): Record<docId, version>` (latest accepted per doc)
- `listMissingAcceptances(userId): { docId, version }[]` (diffs `LEGAL_DOCS` current vs accepted → re-consent set)

### API routes (in `index.ts`)

- `GET /legal` (public) → list all current docs + versions
- `GET /legal/:docId` (public) → `{ doc_id, version, effective, title, body }`
- `POST /legal/accept` (authed) `{ docId, version }` → records acceptance with IP + UA

### The gate

`requireAcceptances(uid, docIds): { docId, version }[]` returns the missing set. Wired into:
- `POST /sessions` (create session) — requires `terms` (and `vps-root-terms` if VPS)
- `POST /billing/checkout` — requires `terms`
- VPS launch — requires `vps-root-terms`

On missing → `409 { error: "acceptance_required", missing: [...] }`. UI renders a re-consent modal.

Signup records Terms + Privacy acceptance inline (unchecked-by-default checkbox). VPS launch records `vps-root-terms` separately in the launch modal.

---

## Section 2 — The four documents

All `.md` in `Atelier-App/content/legal/` (canonical) + mirrored in `atelier-landing/content/legal/`. Each carries the not-legal-advice header, effective date, version string, and `[LEGAL REVIEW: ...]` markers.

1. **`terms.md`** — 13 sections: acceptance/eligibility (16+), service description (hosted vs self-hosted-MIT split), accounts, BYOK/BYOC, AUP (cross-refs ip-policy), user content & code (user owns repos/prompts/outputs; limited license to clone/edit/push; AI output as-is), VPS root-access clause, billing (3-day trial auto-converts, metered overage, flat VPS, cancellation/refunds), availability/beta as-is, suspension & termination (links retention), disclaimers/liability/indemnification `[LEGAL REVIEW: caps]`, governing law `[LEGAL REVIEW: Canadian province/venue]`, changes + contact.
2. **`privacy.md`** — 12 sections matching the verified data inventory: account/identity, encrypted model keys (never in sandbox env), repo code transient in sandboxes, session events/logs, usage metering, billing metadata via Stripe (no raw cards), prompts/tasks. Legal bases `[LEGAL REVIEW]`, no-training-on-user-data stance `[LEGAL REVIEW: confirm true]`, subprocessor list, international transfers `[LEGAL REVIEW: SCCs]`, retention (cross-refs schedule), security (no invented certs), rights (GDPR/PIPEDA/CCPA), cookies, children, changes.
3. **`ip-policy.md`** — respect for IP, AI-generated-code caveat `[LEGAL REVIEW]`, notice-and-takedown (valid report fields, `ip@studioatelier.ca`), counter-notice + restoration `[LEGAL REVIEW: DMCA §512 vs notice-and-notice]`, repeat-infringer escalation, action on valid notice, trademark complaints.
4. **Prompt 4 docs:** `dpa.md` (controller/processor roles `[LEGAL REVIEW]`), `subprocessors.md` (generated from `SUBPROCESSORS`), `data-retention.md` (per-type schedule `[LEGAL REVIEW]` windows), `breach-response.md` (GDPR 72h, PIPEDA "real risk of significant harm", CCPA).

`SUBPROCESSORS` config drives both the `/subprocessors` page and `subprocessors.md`, so the published list can't drift from deployed config.

---

## Section 3 — Privacy controls (Prompt 2 mechanics)

### `GET /account/export`

JSON bundle: account, providers metadata (name/base_url/dialect/models — **never** decrypted keys, mirroring `listProviders`), sessions, events, billing status, acceptances. One query per table. No new table.

### `POST /account/delete` (the cascade)

1. Cancel active sessions via `orch.cancel(id)` for every non-terminal session (drives sandbox `destroy`).
2. VPS: `destroyVps(userId)` (new — calls compute provider destroy if `vm_ref` exists) + null `vm_ref` + cancel Stripe subscription.
3. Delete provider rows (`deleteProvider` each) + `clearCompute` + clear github token ciphertext.
4. Delete sessions + events (`deleteSession` each).
5. Delete `legal_acceptances` rows.
6. Null `user_plan` + cancel Stripe subscription.
7. Anonymize `users` row (tombstone for audit/billing retention `[LEGAL REVIEW]`): `email=null, login='deleted'`, drop ciphertext. `audit_log` entry.
8. Clear session cookie.

Returns `202 { job_id }`; async; email confirmation `[LEGAL REVIEW: email delivery]`.

### Cookie/consent

Session cookie is essential (always on, `httpOnly`). No analytics today → consent banner **built but inert**: `consent` table (`user_id, analytics, accepted_at`) + `POST /account/consent` + banner component rendered only if `NEXT_PUBLIC_ANALYTICS` flag set. Hook present for when tracking lands.

### Settings.tsx

New "Privacy & Data" section: Export (downloads JSON), Delete (confirm-by-typing email), consent toggle (hidden unless analytics configured).

---

## Section 4 — Abuse / takedown workflow (Prompt 3 mechanics)

### `abuse_reports` table (both backends)

`id, type, target_ref, reporter_email, reporter_name, details, status, created_at`.

### `POST /abuse/report` (public — reporter may lack an account)

Validates required notice fields; on insert emails `ip@studioatelier.ca` via a `notify()` helper (stubbed `console.warn` when no SMTP env — no mail dep until a provider is chosen `[LEGAL REVIEW: email delivery]`).

### Admin handling — `POST /admin/abuse/:id/action` (admin-gated)

`{ action: "suspend_session"|"suspend_vps"|"suspend_account"|"dismiss" }`:
- `suspend_session` → `orch.cancel(sessionId)` (real sandbox destroy) + mark report.
- `suspend_vps` → `destroyVps` + `user_plan.status = "suspended"`.
- `suspend_account` → `users.role = "suspended"` (new role value); guarded middleware rejects it (one-line check: `getUser(uid).role === 'suspended'` → 401); cascade-cancel active sessions/VPS.
- Every action appends to `audit_log`.

### Repeat-infringer

`strike_count` = `count(*) from abuse_reports where target_ref = user and status='actioned'`; at threshold `[LEGAL REVIEW: threshold]` → termination path.

### Public form

`/ip-policy` (landing) + `/report` posts to API. Linked from footer, Terms AUP, VPS launch terms.

---

## Section 5 — Data compliance (Prompt 4 mechanics)

### `audit_log` table (both backends)

`id, ts, actor, action, target, meta`. Append-only (`insert` only). Records: key add/remove, exports, deletions, suspensions, subprocessor changes, acceptances. One `audit(action, actor, target, meta)` helper every sensitive path calls.

### Retention job

Reuses the orchestrator's `startReaper` interval (no second scheduler). `sweepRetention()`:
- Purge/anonymize session events older than window `[LEGAL REVIEW: 90 days default]` — delete `events` rows past cutoff for terminal sessions.
- Ensure hibernated/ended sandboxes cleaned (reaper already does orphan destroy).
- Delete cancelled VPS disks after grace `[LEGAL REVIEW: 30 days]` — `destroyVps` on `user_plan` rows where `status='canceled'` and `canceled_at + grace < now`.
- Honor account-deletion cascades (already synchronous in `/account/delete`).

Idempotent (re-runnable `where` clauses), logged to `audit_log`.

### Data minimization tests

- `redact()` applied on event ingest (already is, in `/internal/sessions/:id/events`).
- `/account/export` never includes `key_ciphertext`/`compute_key_ciphertext`/`github_token_ciphertext`/`session_token`.
- No log statement touches a decrypted key.

### Data residency

Document default region + where each data type lives (from `SUBPROCESSORS` + env). Region selection already exists in `user_plan.region`; document, don't build new UI `[LEGAL REVIEW: residency claims]`.

### Region/subprocessor doc sync

Test asserts `SUBPROCESSORS` config matches `subprocessors.md` references — published list can't drift from deployed config.

---

## Public pages (both repos)

Landing (Next.js, `atelier-landing`): `/terms`, `/privacy`, `/ip-policy`, `/subprocessors` — render the mirrored `.md`. Footer "Legal / Meta" column gets these links (currently only "MIT License" + "© 2026").

App (`Atelier-App` web): same pages reachable from the app footer + a legal viewer component. Signup consent checkbox (not pre-checked). Re-consent modal on version bump. VPS root-terms confirmation in the launch modal.

## Testing (DoD)

- Gate + acceptance record (Prompt 1)
- Export completeness — no decrypted keys (Prompt 2)
- Deletion cascade — destroys sandboxes/VPS + key ciphertext + rows + cancels Stripe (Prompt 2)
- Report intake + suspension action (Prompt 3)
- Retention job — expired data purged, VPS disks deleted after grace, deletion cascade honored (Prompt 4)
- Audit log records key events (Prompt 4)
- Keys never logged, never in exports (Prompt 4)
- Subprocessor config ↔ doc sync (Prompt 4)

All as `node --test` files alongside the existing `*.test.ts` in `apps/api/src/`. Build + tests green. Committed + pushed (orchestrator reviews worker diffs first).

## Build order

1. Prompt 1 (foundation: `legal.ts` + `legal_acceptances` + gate + Terms doc + `/terms`).
2. Prompts 2 + 4 together (shared deletion/retention logic): export/delete, retention job, audit log, DPA/subprocessors/retention/breach docs.
3. Prompt 3 (abuse/suspension layers on the audit log + orchestrator).
4. Public pages on both repos + footer links + signup/VPS/checkout gates.

Worker waves of ≤3, disjoint scopes.
