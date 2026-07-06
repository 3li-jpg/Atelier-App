# Atelier — Handoff & Remaining Plan

**For:** the next agent (GLM 5.2) continuing this build.
**Read first:** `Atelier-PRD-v2.md` (product spec), `Atelier-Setup-Implementation-Guide.md` (how-to), `README.md` (what exists + deliberate shortcuts).
**State:** Phase 0 code + control-plane core are done, tested (8/8), committed (`91f789e`). Nothing is deployed. No credentials have been used.

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

Conventions in force (keep them):
- npm workspaces (not pnpm). Node 24, `--experimental-strip-types` — **no constructor parameter properties, no enums, no decorators** (strip-only mode rejects them).
- Tests: `node --test`, no framework. One integration-style test per package, fakes over mocks (see `api.test.ts` `FakeSandbox`).
- SSE (not WebSocket) for the event stream. Cursor replay via `?cursor=N`.
- Ponytail style: minimum code that works; deliberate shortcuts carry a `ponytail:` comment naming the ceiling and upgrade path. The README table lists all current shortcuts — honor its "upgrade when" triggers, don't upgrade early.

---

## 2. Task list (ordered — do them in this order)

Blocked-on-human tasks are marked 🔑 (need the owner's accounts/keys). Everything else is pure code you can do immediately.

### T1 🔑 Run the Phase 0 spike (guide §1.2–1.3) — *gate for T4*
1. `brew install flyctl && fly auth login` (card attached); `fly apps create atelier-sandboxes`.
2. `cd runner && fly deploy --build-only --push -a atelier-sandboxes --image-label runner-v0`.
3. Boot one machine via curl per guide §1.2 with the owner's Umans key + fine-grained GitHub PAT against a throwaway repo. **Exit: a real PR on GitHub.**
4. Measure suspend→start resume latency 5+ times (guide §1.3). Record numbers in `docs/spike-notes.md` — they decide T4's thresholds.
5. Run the task 5–10× across 2–3 models; note failure modes for T8's conformance suite.

### T2 — Sealed-box secrets handshake (guide §2.6) — *before any multi-user deploy*
Replace env-var key injection (`orchestrator.ts` `launch()`, marked `ponytail:`):
1. Orchestrator: per-session X25519 keypair (`crypto.generateKeyPair('x25519')`); pass only the **public** key + `HANDSHAKE_URL` in machine env.
2. New route `POST /internal/sessions/:id/handshake`: supervisor posts its own pubkey + the session bearer token; orchestrator replies with `{llm_key, git_token, task}` sealed to the supervisor's key. Use libsodium sealed boxes (`sodium-native`) or, ponytail option, Node's built-in `crypto.diffieHellman` X25519 ECDH + AES-GCM — no new dep.
3. Supervisor (`runner/supervisor.sh`): generate keypair at boot, fetch config, decrypt in memory, `unset` the raw envs. This is the point to promote supervisor.sh to a small TS binary if bash gets painful — but only if it actually does.
4. Test: handshake round-trip with a fake supervisor in `api.test.ts`; assert the LLM key never appears in machine `env` config.

### T3 — Auth on the public API — *before any deploy*
- Sign in with Apple (JWT verify against Apple's JWKS) + GitHub OAuth. `users` table in the store; every `/providers` and `/sessions` row scoped by `user_id`; middleware rejects unauthenticated requests.
- Ponytail floor: a single static bearer token from env is acceptable for the owner-only alpha deploy — but gate T10 (TestFlight to others) on real auth.

### T4 — Hibernation + reaper (PRD D6, needs T1's latency data)
- `apps/api/src/orchestrator.ts`: on `awaiting_user` state >30 s → `sandbox.suspend()`, state → `hibernated`; on user reply → `resume()`. Suspended >10 min → `stop()`.
- Reaper: `setInterval` sweep (in-process is fine, single instance) — any session past wall-clock TTL, or machine orphaned (in Fly but session terminal) → destroy + `error` event. Chaos test: kill the API mid-session, restart, reaper cleans up.
- Supervisor side: emit `question` events and an idle heartbeat so the orchestrator can detect model-wait >30 s.

### T5 — GitHub App (guide §2.7) 🔑 registration, then code
- Register app (permissions `contents:rw`, `pull_requests:rw`, `metadata:r`; webhook → `/webhooks/github`).
- Code: Octokit installation-token minting per session (1 h expiry), repo/branch listing endpoints (`GET /repos`, `GET /repos/:id/branches`), webhook handler → PR-check push notifications. Replace the global `GIT_TOKEN` env with per-session installation tokens.
- Supervisor gains a `create_pr` step: after push, POST the PR via the API (utility model drafts title/body later — plain `task` text is fine for now).

### T6 — Deploy the control plane 🔑
`fly deploy -c infra/fly.api.toml`; `fly secrets set` MASTER_KEY, FLY_SANDBOX_TOKEN, GIT/GitHub App creds. Point `PUBLIC_URL` at the deployed host. Re-run a full session end-to-end against it. **Note:** DB is `node:sqlite` on a Fly volume — attach a volume, or if you deploy >1 machine, this is the README's trigger to swap to Neon Postgres. Don't swap before then.

### T7 — iOS app (guide §3) — the big one
SwiftUI, iOS 17+, new Xcode project at `apps/ios`. Build in this order:
1. **Core/APIClient** — hand-write a small client (the API surface is ~10 endpoints; skip OpenAPI codegen). **Core/EventStream** — actor wrapping `URLSession.bytes(for:)` SSE parsing, cursor persisted per session, merge with GRDB cache (or, ponytail floor: in-memory + refetch-from-cursor-0 on open; add GRDB when scrollback lag is felt).
2. **Sessions list + Chat timeline** — typed event cells; `tool_call` collapsed w/ exit-code badge; `question` renders quick-reply chips → `POST /sessions/:id/reply` (add this endpoint to the API: appends a `user_message` event + delivers to supervisor via a poll or exec channel — supervisor side needed too).
3. **NewTask sheet** — repo → branch → provider/model → prompt.
4. **Providers screen** — add/validate (calls `/providers/validate`, shows latency + tool-call fidelity).
5. **DiffView + Terminal tabs** — parse diffs **server-side** into hunk JSON (add `GET /sessions/:id/diff`); SwiftTerm fed by `tool_call` output events.
6. **Push (APNs)** 🔑 needs Apple Developer account — notify worker in the API on `question`/`completed`/`failed` events; deep-link payload `{session_id, event_seq}`. Live Activities after basic push works.
**Exit: a PR shipped entirely from the phone.**

### T8 — Conformance suite (guide §4)
`packages/conformance/`: script taking base URL + key, scoring tool-call fidelity (20 canned prompts), edit reliability (fixture repo patch), streaming stability, end-to-end spike task. Output: pass/fail + quirks JSON. Wire presets (Umans, OpenRouter, Together, …) into a remote-config JSON the app fetches. Nightly run = a GitHub Action once the repo is on GitHub.

### T9 — Billing & quotas (PRD §6.6)
- `billed_seconds` accounting already has a column — write deltas at every start/suspend/stop transition in the orchestrator.
- RevenueCat webhooks → tier on `users`; middleware enforces concurrent-session cap + monthly hours; soft-cap → throttle to 1 concurrent.
- Ponytail: skip Stripe external-link until US App Store submission forces the question.

### T10 — Launch checklist (guide §5)
Work through it literally: chaos-test reaper, fuzz redaction with real key formats, verify `curl evil.example` fails inside a session, RevenueCat sandbox test, App Review notes, status page.

---

## 3. Dependency graph

```
T1 (spike🔑) ──► T4 (hibernation)
T2 (sealed box) ──► T6 (deploy🔑) ──► T7.6 (push🔑)
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
