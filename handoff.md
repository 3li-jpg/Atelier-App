# Atelier — Handoff & Remaining Plan

**For:** the next agent (GLM 5.2) continuing this build.
**Read first:** `Atelier-PRD-v2.md` (product spec), `Atelier-Setup-Implementation-Guide.md` (how-to), `README.md` (what exists + deliberate shortcuts).
**⚠️ Product pivot (2026-07-05, owner decision, supersedes the PRD where they conflict):** no iOS/App Store app. The client is an **installable PWA** (desktop + mobile browser, add-to-home-screen), the project is **open source** with a self-host path (BYO Fly account), and payments are Stripe-direct. PRD §6.5 (Live Activities/Siri), §6.6 (RevenueCat), NFR-5, and the App Review milestones/risks no longer apply. See T7 and T-OSS.
**State:** Phase 0 code + control-plane core are done, tested (8/8). Fly account is live (`alirafi321@gmail.com`, personal org), `atelier-sandboxes` app exists, runner image is built and pushed. T1 is partially complete — see its checklist.

**Keep this file current:** as you finish tasks, move them into §1's done table (or check them off) with a one-line note of what you actually did. This file is the source of truth for the next session.

---

## 1. What already exists (do not rebuild)

| Piece | Where | Status |
|---|---|---|
| Runner image: Dockerfile, supervisor, egress firewall | `runner/` | Done, shell-lint clean, never built/pushed |
| Event/session/provider zod schemas + FSM transition table | `packages/schema/src/index.ts` | Done, 4 tests |
| `SandboxProvider` interface + `FlyMachinesProvider` | `packages/sandbox/src/` | Done, 1 test |
| Control plane: provider CRUD, validation probe, sessions, orchestrator w/ budgets, event ingest + redaction, SSE stream w/ cursor replay | `apps/api/src/` | Done, 3 tests |
| Secrets: AES-256-GCM under `MASTER_KEY`, redaction filter | `apps/api/src/secrets.ts` | Done |
| `infra/fly.api.toml` | `infra/` | Done |
| flyctl installed + authed (`alirafi321@gmail.com`) | local machine | Done |
| Fly app `atelier-sandboxes` created (personal org) | Fly | Done |
| Runner image built & pushed | `registry.fly.io/atelier-sandboxes:runner-v0` | Done — OpenCode pinned to **1.17.13** (installer rejects `VERSION=latest`); needed `runner/fly.toml` (build config only) |
| Machine create verified via Machines API | Fly | Done — machine `d893273f2445e8` booted in **sjc**; `sea` is deprecated, all defaults updated to sjc |

Conventions in force (keep them):
- npm workspaces (not pnpm). Node 24, `--experimental-strip-types` — **no constructor parameter properties, no enums, no decorators** (strip-only mode rejects them).
- Tests: `node --test`, no framework. One integration-style test per package, fakes over mocks (see `api.test.ts` `FakeSandbox`).
- SSE (not WebSocket) for the event stream. Cursor replay via `?cursor=N`.
- Ponytail style: minimum code that works; deliberate shortcuts carry a `ponytail:` comment naming the ceiling and upgrade path. The README table lists all current shortcuts — honor its "upgrade when" triggers, don't upgrade early.

---

## 2. Task list (ordered — do them in this order)

Blocked-on-human tasks are marked 🔑 (need the owner's accounts/keys). Everything else is pure code you can do immediately.

### T1 🔑 Run the Phase 0 spike (guide §1.2–1.3) — *gate for T4* — PARTIALLY DONE
1. ~~Install flyctl, auth, create app~~ **done.**
2. ~~Build & push runner image~~ **done** → `registry.fly.io/atelier-sandboxes:runner-v0`.
3. 🔑 Boot one machine via curl per guide §1.2 with the owner's Umans key + fine-grained GitHub PAT against a throwaway repo. Use region **sjc** (not sea — deprecated). **Exit: a real PR on GitHub.**
4. ~~Measure resume latency~~ **done** → `docs/spike-notes.md`: suspend→start ≈ 0.75 s, stop→start ≈ 1.6 s. T4 policy: suspend on `awaiting_user`, demote to stop after **2 min** (not 10). Probe machine destroyed.
5. Run the task 5–10× across 2–3 models; note failure modes for T8's conformance suite.

### T2 — Sealed-box secrets handshake (guide §2.6) — ✅ DONE
Implemented with Node built-in X25519 ECDH + HKDF + AES-256-GCM (no new deps):
- `apps/api/src/secrets.ts`: `sealConfig()` / `openSealed()` (test helper).
- `apps/api/src/orchestrator.ts`: machine env now carries only `SESSION_ID`, `HANDSHAKE_URL`, `EVENTS_URL`, `SESSION_TOKEN` — zero secrets; `handshake()` seals `{repo_url, branch, task, llm_*, git_token}` to the supervisor's pubkey.
- `POST /internal/sessions/:id/handshake` route (session-bearer-authed, 32-byte pubkey enforced); internal auth factored into `sessionAuth()`.
- `runner/handshake.mjs` = supervisor half; `supervisor.sh` uses it when `HANDSHAKE_URL` is set, falls back to env vars for manual spike runs. Handshake runs **before** the firewall (firewall needs the endpoint host from the config).
- Tested in `api.test.ts`: env asserted secret-free, full seal→open round-trip over HTTP, wrong-token 401.
- Image rebuilt as `registry.fly.io/atelier-sandboxes:runner-v1` (orchestrator `RUNNER_IMAGE` default still says v0 — set env or bump default when deploying).
- Note: authenticity = session bearer + TLS; keys are ephemeral per handshake. Fine for single-user; revisit if threat model grows.

### T3 — Auth on the public API — ✅ FLOOR DONE, full auth still open
- **Done:** static bearer middleware in `index.ts` — set `AUTH_TOKEN` env and every public route requires it (`/health` and `/internal/*` exempt; timing-safe compare). Tested. Enough for the owner-only alpha deploy.
- **Open:** real auth for other users — with the web pivot this is now GitHub OAuth (fits the GitHub App flow) rather than Sign in with Apple. `users` table + per-user row scoping. Gate public availability on it.

### T4 — Hibernation + reaper — ✅ MOSTLY DONE
- **Done** in `orchestrator.ts`: `awaiting_user` >30 s → suspend → `hibernated`; suspended >2 min → stop (thresholds from spike data, env-overridable via `SUSPEND_AFTER_MS`/`STOP_AFTER_MS`, read lazily). `wake()` resumes on user reply. Reaper `sweep()` on 60 s interval kills wall-clock TTL breaches + destroys machines; started in `index.ts` main. `POST /sessions/:id/reply` records a `user_message` event (new schema type) and wakes. All timers per-session, unref'd, keyed `sessionId:kind`. Tested end-to-end with fast timers.
- **Open:** (a) supervisor-side: emit `question` events + deliver `user_message` replies to the harness (needs an exec/poll channel — see T7.2); (b) supervisor idle heartbeat for model-wait >30 s detection; (c) reaper orphan scan (machines existing in Fly whose session is terminal — needs a Machines list call in `SandboxProvider`); (d) chaos test: kill API mid-session, restart, verify cleanup. Note the in-memory timers die with the process — the reaper covers TTLs after restart, but a suspended machine's stop-demotion timer is lost until its session is swept.

### T5 — GitHub App (guide §2.7) 🔑 registration, then code
- Register app (permissions `contents:rw`, `pull_requests:rw`, `metadata:r`; webhook → `/webhooks/github`).
- Code: Octokit installation-token minting per session (1 h expiry), repo/branch listing endpoints (`GET /repos`, `GET /repos/:id/branches`), webhook handler → PR-check push notifications. Replace the global `GIT_TOKEN` env with per-session installation tokens.
- Supervisor gains a `create_pr` step: after push, POST the PR via the API (utility model drafts title/body later — plain `task` text is fine for now).

### T6 — Deploy the control plane 🔑
`fly deploy -c infra/fly.api.toml`; `fly secrets set` MASTER_KEY, FLY_SANDBOX_TOKEN, GIT/GitHub App creds. Point `PUBLIC_URL` at the deployed host. Re-run a full session end-to-end against it. **Note:** DB is `node:sqlite` on a Fly volume — attach a volume, or if you deploy >1 machine, this is the README's trigger to swap to Neon Postgres. Don't swap before then.

### T7 — Web app (PWA) at `apps/web` — the big one — **PIVOTED 2026-07-05: was iOS/SwiftUI**
Owner decision: no App Store. Installable PWA (add-to-home-screen prompt), works desktop + mobile browser. Kills App Review risk, Apple fees, RevenueCat; Stripe direct. Project goes **open source** (see T-OSS).
Stack: Vite + React SPA (ponytail: no Next.js — there's no SSR need; the API is separate). Serve the built bundle from the Hono app so it's one deploy.
1. ✅ **API client + event stream** — `apps/web/src/api.ts` (typed fetch client) + `useEventStream.ts` (native `EventSource`, cursor persisted per-session in localStorage). Dev runs on Vite :5173 with a same-origin proxy to the API :3000 (zero backend change, no CORS); SPA routes use non-colliding prefixes (`/s/:id`) so browser nav never shadows API paths. Build verified: `tsc --noEmit && vite build` clean, ~48 kB gzipped.
2. ✅ **Sessions list + Chat timeline** — `SessionsList` + `SessionView` + `EventCell` (`apps/web/src/{views,components}`). Typed cells: `tool_call` collapsed w/ exit-code badge; `question` renders quick-reply chips → `POST /sessions/:id/reply` (endpoint added in T4); `assistant_text`/`user_message` bubbles, `state_change` pill, `error`, `commit`, `file_diff`, verbose `<details>` fallback. Live state derived from the stream. **Open:** supervisor-side delivery of `user_message` to the harness (the exec/poll channel — same blocker as T4a).
3. ✅ **NewTask form** — `apps/web/src/views/NewTask.tsx`: repo URL + branch (default main) + provider/model selects (driven by `/providers`) + task → `POST /sessions` → opens the session view. Tabbed nav (Sessions/New/Providers) in `App.tsx`. Validation in `lib.ts` (`validateNewTask`, tested). ponytail: repo/branch typed manually — listing arrives with the GitHub App (T5).
4. ✅ **Providers screen** — `apps/web/src/views/Providers.tsx`: list + add-provider form (name/base_url/dialect/model_id/api_key) + Validate button calling `/providers/validate` (shows latency, completion, tool-call fidelity) + Save. Validation in `lib.ts` (`validateProviderForm`, tested). ponytail: single model entry; multi-model + quirks editing later.
5. **Diff + Terminal tabs** — parse diffs **server-side** into hunk JSON (add `GET /sessions/:id/diff`); xterm.js fed by `tool_call` output events.
6. **PWA layer** — manifest + service worker + add-to-home-screen prompt (iOS needs the manual Share→Add flow explained in-UI); **Web Push** (VAPID, `web-push` npm) on `question`/`completed`/`failed`, deep-link `{session_id, event_seq}`. iOS web push only works when installed — make the install prompt prominent, it gates the core notify loop.
**Exit: a PR shipped entirely from a phone browser.**

### T-OSS — Open-source readiness (new, owner decision) — ✅ FLOOR DONE
- LICENSE (MIT — owner picked), CONTRIBUTING.md, self-host quickstart in README. ✅ Done: `LICENSE` (MIT), `CONTRIBUTING.md`; README Phase 0 spike section doubles as the self-host quickstart (bring your own Fly account: `fly apps create`, push runner image, set secrets — 80% there). README header + simplifications table synced to the PWA pivot (sealed-box row removed — T2 done; auth row = static bearer; `URLSession`→`EventSource`); stale iOS/Apple refs removed from `index.ts` comments.
- Audit git history for secrets before publishing. ✅ Done: scanned `git log -p --all` for ghp_/github_pat_/sk-/fly_/AKIA/xox/private-key patterns — zero hits (placeholders only in `.env.example`).
- `.env.example` with every env var the API reads. ✅ Done: covers MASTER_KEY, AUTH_TOKEN, FLY_SANDBOX_TOKEN, FLY_SANDBOX_APP, GIT_TOKEN, PUBLIC_URL, RUNNER_IMAGE, DB_PATH, PORT, SUSPEND_AFTER_MS, STOP_AFTER_MS, REAPER_INTERVAL_MS (all read by `apps/api/src/{index,orchestrator,secrets,store}.ts`).
- Consequence for T9: billing becomes optional/pluggable — hosted tier uses Stripe, self-hosters run without quotas. (Picked up with T9; RevenueCat already dropped with the iOS app.)

### T8 — Conformance suite (guide §4)
`packages/conformance/`: script taking base URL + key, scoring tool-call fidelity (20 canned prompts), edit reliability (fixture repo patch), streaming stability, end-to-end spike task. Output: pass/fail + quirks JSON. Wire presets (Umans, OpenRouter, Together, …) into a remote-config JSON the app fetches. Nightly run = a GitHub Action once the repo is on GitHub.

### T9 — Billing & quotas (PRD §6.6) — **UPDATED for web pivot**
- `billed_seconds` accounting already has a column — write deltas at every start/suspend/stop transition in the orchestrator.
- Stripe Checkout + webhooks → tier on `users` (RevenueCat/StoreKit deleted with the iOS app); middleware enforces concurrent-session cap + monthly hours; soft-cap → throttle to 1 concurrent.
- Must be optional for self-hosters: no Stripe keys configured → no quotas enforced.

### T10 — Launch checklist (guide §5)
Work through it literally: chaos-test reaper, fuzz redaction with real key formats, verify `curl evil.example` fails inside a session, RevenueCat sandbox test, App Review notes, status page.

---

## 3. Dependency graph

```
T1 (spike🔑) ──► T4 (hibernation)
T2 (sealed box) ──► T6 (deploy🔑) ──► T7.6 (web push — no Apple account needed)
T3 (auth) ──────► T6
T5 (GitHub App🔑) ──► T6, T7.2
T7.1–7.5 (iOS core) — parallel with T2–T6, needs only the local API
T8 — anytime after T1
T9 — after T3
T10 — last
```

Suggested execution: **T2 + T3 + T7.1–7.2 in parallel** (pure code, no keys), while the human runs T1 and registers T5's GitHub App. Then T4 → T5 code → T6 → rest of T7 → T8/T9 → T10.

## 4. Working agreements

- Run `npm test` before every commit; add one integration-style test per new surface (same style as `api.test.ts`).
- Anything the PRD lists under §9 Security is **not** a valid ponytail shortcut: egress allow-list, redaction, budget kill-switches, key handling stay full-strength.
- When the guide and this file disagree with observed reality (Fly API drift, OpenCode flag changes), trust reality, fix the doc in the same commit.
- Never let a provider failure read as an Atelier failure: error events must say "your endpoint returned …".
- Commit style: what changed + why, imperative subject, like `91f789e`.
