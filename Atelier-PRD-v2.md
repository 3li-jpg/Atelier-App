# PRD: Atelier — Mobile Vibe Coding with Your Own Models

**Version:** 2.0
**Product name:** Atelier
**Date:** July 2026
**Platform:** iOS first (SwiftUI). Backend on Fly.io. Android fast-follow.
**Tagline:** *Your models. Your endpoints. Ship from anywhere.*

---

## 1. Executive Summary

Atelier is a mobile app that lets developers run full agentic coding sessions from their phone against **any OpenAI- or Anthropic-compatible model endpoint**. The agent runs in an ephemeral Firecracker microVM on Fly.io — a real Linux dev environment with git, package managers, test runners, and a shell. The phone is a remote control and review surface: kick off tasks, watch the agent stream plans/diffs/terminal output, answer its questions, review the diff, merge the PR.

Users bring their own inference — a Umans coding plan (GLM 5.2 / Kimi K2.7-Code), OpenRouter, Together, Fireworks, DeepSeek, a self-hosted vLLM box — configured as a provider with a base URL + API key, exactly like OpenCode on desktop. Atelier charges for **compute and convenience, never tokens**.

**One-line pitch:** *Claude Code's mobile cloud-agent experience, for your models and your usage plans.*

**Why the name:** an atelier is a master's workshop — apprentices do the work, the master reviews it. That is precisely the product's interaction model.

---

## 2. Problem Statement

1. **Mobile agentic coding exists but is vendor-locked.** Claude Code's app, Cursor's agents, Copilot's coding agent — all hard-code the model provider. No App Store app accepts a custom base URL + API key for agentic coding.
2. **Developers increasingly own flat-rate inference elsewhere.** Plans like Umans' give effectively unlimited GLM 5.2 / Kimi K2.7-Code via standard OpenAI/Anthropic-compatible endpoints — usable today only from desktop CLIs and IDEs.
3. **The agent layer is a solved problem.** OpenCode, Cline, Kilo Code, Crush all accept custom endpoints. The missing pieces are (a) hosted execution and (b) a mobile-native UX. Atelier builds exactly those two and nothing else.

---

## 3. Goals & Non-Goals

### Goals (v1)
- **G1:** Add a custom provider (name, base URL, key, dialect, models) in <60 s with a validation test that includes a tool-calling round-trip.
- **G2:** Connect GitHub → pick repo/branch → describe task → agent completes end-to-end: clone → plan → edit → run tests → commit → PR.
- **G3:** Live streamed session (assistant text, tool calls, terminal, diffs) with mid-run steering, interrupt, and blocking questions.
- **G4:** Sessions survive app backgrounding/kill; push notifications for needs-input / complete / failed; iOS Live Activities.
- **G5:** Keys encrypted at rest (KMS envelope), injected into the microVM only at boot, never logged, never on the phone.
- **G6:** App Store compliant: all execution is remote; the app renders results.
- **G7 (new in v2):** Unit economics on Fly Machines: fully-loaded COGS per heavy Pro user ≤ $5/mo; hibernation during waits cuts billed hours ≥40%.

### Non-Goals (v1)
- No first-party inference; BYO-endpoint only (Umans is a *preset*, one of many — not a dependency).
- Not a mobile IDE; editing beyond diff review + steering is out of scope.
- No on-device execution. No Android in v1 (backend is client-agnostic). No teams/orgs in v1.

---

## 4. Personas

- **P1 — The Plan Maximizer (primary):** owns an unlimited coding plan (e.g., Umans GLM 5.2), uses 4–6 tools already, wants agents shipping while away from the desk. Success = 3+ tasks/day from phone.
- **P2 — The Self-Hoster:** vLLM/LiteLLM in a VPC or homelab; needs strict egress guarantees and (v1.5) private-endpoint reachability via Tailscale/WireGuard.
- **P3 — The Side-Project Weekender:** OpenRouter credits, blank-project mode, wants idea → preview URL with minimal ceremony.

---

## 5. Competitive Landscape

| Product | Mobile | Cloud exec | Custom endpoint | Gap Atelier fills |
|---|---|---|---|---|
| Claude Code app + cloud | Yes | Yes | No | model lock-in |
| Cursor agents | Web-ish | Yes | Partial (BYOK, not agent-grade custom URLs on mobile) | mobile + neutrality |
| Copilot coding agent | Via GitHub app | Yes | No | interactivity + neutrality |
| OpenCode / Pi / Crush | No | Local | Yes | mobility + hosting |
| Umans Cloud Agents | Browser | Yes | Their models | mobile-native + any endpoint |

**Positioning:** the only mobile-native client where **execution is hosted but inference is yours**.

---

## 6. Product Requirements

### 6.1 Providers
- **FR-1.1** Add provider: name, base URL, API key, dialect (`openai-chat` | `openai-responses` | `anthropic-messages`), custom headers, model list (or auto-fetch `/v1/models`).
- **FR-1.2** Remote-config presets: Umans (`https://api.code.umans.ai/v1`), OpenRouter, Together, Fireworks, Groq, DeepSeek, Moonshot, Z.ai, Anthropic, OpenAI, generic vLLM/LiteLLM/Ollama.
- **FR-1.3** Validate button: cheap completion + tool-call round-trip; report latency, tool-calling fidelity, context window if discoverable. Fail loudly before a session is wasted.
- **FR-1.4** Multiple providers; per-role model assignment: **coder** (e.g., `umans-kimi-k2.7`) and **utility/fast** (e.g., `umans-flash`) for titles, summaries, PR bodies.
- **FR-1.5** Keys: KMS envelope encryption; shown once; deletable; excluded from logs/analytics/crash reports; redaction filter on all streamed output.

### 6.2 Projects
- **FR-2.1** GitHub App OAuth, per-repo least-privilege install; GitLab v1.5.
- **FR-2.2** Blank-project mode; later "Publish to GitHub."
- **FR-2.3** Per-repo env config: base image (node/python/go/rust/full), setup script, encrypted env vars, **warm snapshot toggle** (Fly Machine created from a pre-baked image + suspended state for fast starts).
- **FR-2.4** Honor `AGENTS.md` / `CLAUDE.md` in-repo.

### 6.3 Sessions (core loop)
- **FR-3.1** New session = repo + branch + provider/model + prompt (text or voice).
- **FR-3.2** Orchestrator boots a Fly Machine, clones repo, runs setup, starts the harness pointed at the user's endpoint.
- **FR-3.3** Typed event stream: `assistant_text`, `plan_update`, `tool_call`, `file_diff`, `question`, `test_run`, `commit`, `usage`, `error`, `state_change`.
- **FR-3.4** Steer, pause, stop, approve/deny at any time.
- **FR-3.5** Permission modes: **Auto** (default), **Review-gated**, **Plan-first**.
- **FR-3.6** Budgets: max wall-clock (default 30 min), max agent turns; **auto-hibernate** (Fly Machine suspend/stop) on `awaiting_user` and on model-wait >30 s.
- **FR-3.7** Concurrent sessions per tier; session list with live status chips.

### 6.4 Review & Ship
- **FR-4.1** Mobile diff viewer (per-file, syntax highlighted, comment-to-steer).
- **FR-4.2** One-tap Create PR (title/body drafted by utility model) / Commit / Discard.
- **FR-4.3** Terminal tab with full scrollback + manual shell input.
- **FR-4.4** Live preview URLs (Fly proxy to the machine's exposed port) rendered in-app.
- **FR-4.5** Artifacts exportable as markdown; retention per policy.

### 6.5 Ambient UX
- **FR-5.1** Push (needs-input / done / failed / checks finished) deep-linking to the event.
- **FR-5.2** Live Activities / Dynamic Island; **FR-5.3** widget + Siri Shortcut.

### 6.6 Billing & Limits
- **FR-6.1** Sign in with Apple / GitHub.
- **FR-6.2** Free: ~15 sandbox-hrs/mo, 1 concurrent, cold starts, 7-day history. **Pro $17–20/mo:** ~100 hrs soft cap, 3 concurrent, warm starts, 30-day retention, preview URLs. **Power $40–50/mo:** soft-unlimited hrs, 8 concurrent, manual shell always on. Annual −2 months. Founding-member rate at launch.
- **FR-6.3** Soft-cap behavior: past included hours → throttle to 1 concurrent or $0.10/sandbox-hr overage (still >3× Fly cost = margin). Hard quotas on CPU/RAM/disk/egress per tier.

### 6.7 NFRs
- **NFR-1** First streamed token <10 s warm (<45 s cold); stream latency <500 ms.
- **NFR-2** Event log is source of truth; reconnect = replay from cursor; 99.5% control-plane availability.
- **NFR-3** Security per §9. **NFR-4** Fully-loaded COGS <30% of revenue (Fly economics: expect ~$3–5/heavy user → ~75–85% margin at $17–20). **NFR-5** App Review: server-side execution only.

---

## 7. Architecture (Fly-committed)

```
┌──────────────┐  HTTPS/WSS  ┌─────────────────────────────────────────┐
│  iOS app     │◄───────────►│ Control plane (Fly app "atelier-api")   │
│  (SwiftUI)   │ REST+events │  auth · providers · sessions · billing  │
└──────┬───────┘             └──────┬─────────────────┬────────────────┘
       │ APNs                        │                 │
┌──────▼───────┐             ┌──────▼───────┐  ┌──────▼────────────┐
│ Notification │◄────────────│ Orchestrator │  │ Postgres (Neon)   │
│  worker      │             │ (session FSM │  │ Redis (Upstash)   │
└──────────────┘             │  + reaper)   │  │ events · queues   │
                             └──────┬───────┘  └───────────────────┘
                                    │ Machines API (create/start/
                                    │ suspend/stop/destroy/exec)
                    ┌───────────────▼─────────────────────────────┐
                    │ Fly app "atelier-sandboxes" (separate org/app│
                    │ per env). One Machine per session:           │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ atelier-runner image                     │ │
                    │  │  supervisor ─ OpenCode server (headless) │ │
                    │  │  tools: bash·edit·grep·git·(chromium)    │ │
                    │  │  egress firewall (nftables allow-list)   │ │
                    │  └───────────────┬─────────────────────────┘ │
                    └──────────────────┼───────────────────────────┘
                                       ▼ HTTPS only to allow-listed hosts
                     user's endpoint (api.code.umans.ai · openrouter.ai ·
                     self-hosted vLLM) + git host + registries
```

### Key decisions (v2 deltas in bold)

- **D1 — Harness:** OpenCode server (pinned fork) behind an internal `HarnessAdapter`; Claude-Code-as-engine optional later for Anthropic-dialect plans.
- **D2 — Inference path:** sandbox → user endpoint direct; Atelier never proxies tokens. Egress allow-list = endpoint host + git host (+ registries unless strict mode).
- **D3 — Substrate: Fly Machines, committed.** One Machine per session in a dedicated Fly app. Rationale: ~$0.03/hr for 2 vCPU/4 GB (3–5× cheaper than managed sandbox platforms), per-second billing, `suspend` (RAM snapshot, ~sub-second-to-few-second resume) and `stop` (rootfs only, $0.15/GB/mo) map directly onto the hibernation FSM, Firecracker isolation, and `flyd` gives create→running in single-digit seconds from a pulled image. **Keep the `SandboxProvider` interface anyway** with a Daytona/E2B failover implementation (mitigates Fly reliability incidents; also useful for regions Fly lacks).
- **D4 — Event log as source of truth:** Postgres `events` append-only + Redis stream fan-out; WS clients resume by cursor.
- **D5 — Dialect adapters + remote-config quirks** per provider (tool-call delta bugs, `parallel_tool_calls`, missing `usage`).
- **D6 (new) — Hibernation policy:** suspend on `awaiting_user`; suspend on model-wait >30 s (the supervisor watches harness idle state); stop (not suspend) after 10 min suspended; destroy after session end + artifact upload. Reaper kills anything violating TTLs.
- **D7 (new) — Warm starts:** per-repo snapshot = a stopped Machine with deps installed, cloned repo at last-known ref; "new session" on a snapshotted repo = start machine + `git fetch` + reset, target <10 s to first token.

### Session FSM
`created → provisioning → cloning → setup → running ⇄ awaiting_user ⇄ hibernated → finalizing → completed | failed | cancelled`, timeouts on every state, all transitions emitted as `state_change` events.

---

## 8. Tech Stack

### Mobile (iOS)
SwiftUI (iOS 17+) · Swift Concurrency + `URLSessionWebSocketTask` · SwiftTerm (terminal) · SwiftTreeSitter + custom diff renderer · GRDB event-log cache · Keychain (session tokens only) · APNs + Live Activities · RevenueCat/StoreKit 2 · Sentry + TelemetryDeck (scrubbed).

### Backend (all on Fly.io)
| Component | Choice |
|---|---|
| API + Orchestrator | TypeScript, **Hono** on Node 22, deployed as Fly app `atelier-api` (2× shared-cpu-1x to start) |
| Realtime | WebSocket endpoint on same app; Redis Streams fan-out |
| DB | Postgres — Neon (serverless) or Fly Managed Postgres |
| Cache/queues | Upstash Redis (BullMQ for jobs: provisioning, reaping, notifications) |
| Sandboxes | Fly **Machines API** on app `atelier-sandboxes`; image `atelier-runner` |
| Secrets | AWS KMS envelope encryption; libsodium sealed boxes for boot-time key injection |
| Git | GitHub App (Octokit), short-lived per-repo installation tokens |
| Storage | Tigris (Fly-native S3) or Cloudflare R2 for artifacts/log archives |
| Push | APNs token-based auth |
| Billing | StoreKit 2 + RevenueCat; Stripe web checkout (US external-link entitlement) |
| Observability | OpenTelemetry → Grafana Cloud/Honeycomb; per-session trace ID threading phone→API→machine |
| IaC | Terraform (Fly provider) + fly.toml per app |

### atelier-runner image (in-sandbox)
Ubuntu 24.04 LTS · git, ripgrep, curl, build-essential · toolchain variants (node20/python312/go/rust/full) · **supervisor** (Go or TS binary: PID 1; receives sealed session config; launches OpenCode server; translates its event stream → Atelier event schema; enforces budgets; watches idle → requests suspend; uploads artifacts; scrubs secrets from output) · OpenCode server pinned fork · optional headless Chromium · nftables egress allow-list rendered at boot from session config.

---

## 9. Security

1. One Firecracker microVM per session; destroyed post-session (or stopped-encrypted for snapshots).
2. Egress allow-list per session (endpoint + git host + registries; strict mode = endpoint + git only) — blast-radius control for prompt injection and key exfiltration.
3. Keys: KMS-encrypted at rest; decrypted only in orchestrator memory; delivered via sealed box over the Machines exec channel; env-only in the harness process; never on machine disk; entropy + known-prefix redaction on all streamed output.
4. Dangerous-command gating defaults (`rm -rf /`, force-push to protected branches, `curl | sh` to non-allow-listed hosts, publish commands).
5. No training on user code; default 30-day retention; "zero retention after PR" option; full export/delete.
6. Abuse: free tier requires card or GitHub account age check; CPU-pattern mining detection; egress caps.

---

## 10. Cost Model (Fly Machines)

**Unit:** 2 vCPU / 4 GB shared Machine ≈ $0.03/hr running (≈$0.018/hr with 40% reserved blocks); stopped = $0.15/GB rootfs/mo; suspended ≈ RAM held briefly, then stop.

| Profile | Sessions | Billed hrs/mo (with hibernation) | Fly cost |
|---|---|---|---|
| Typical Pro | 3/day × 30 min | ~25 hr | ~$0.75 |
| Heavy Pro | 5–6/day | ~55 hr | ~$1.70 |
| Power abuser | 4 parallel × 8 hr × 22 d | ~350–400 hr | ~$11 |

Add ~20% for egress (clones, npm), snapshot storage, control plane share → **fully-loaded heavy Pro ≈ $3–5/mo against a $17–20 sub (~75–85% margin); worst-case Power abuser ≈ $15 against $40–50.** Control plane fixed costs at launch: ~$25–60/mo (API machines + Neon + Upstash + R2 + domain). Reserved blocks once concurrency is predictable: −40% on the biggest line item.

---

## 11. Milestones

| Phase | Weeks | Scope | Exit |
|---|---|---|---|
| 0 Spike | 2 | atelier-runner image; OpenCode headless in a Fly Machine against Umans; CLI-driven; event capture | GLM 5.2 / Kimi K2.7 ships a real PR remotely |
| 1 Alpha | 6 | Control plane, GitHub App, iOS Home/New/Session(Chat+Terminal), push, hibernation v1 | 10 real PRs shipped from your phone |
| 2 Beta | 6 | Diff viewer, PR sheet, permission modes, warm snapshots, presets + conformance suite, Live Activities, reaper | 50 testers; ≥60% sessions → PR/commit; crash-free >99% |
| 3 Launch | 4 | RevenueCat, quotas/soft caps, blank projects, preview URLs, App Review | Live; Free/Pro/Power |
| 4 v1.5 | — | Android, GitLab, Tailscale private endpoints, MCP tools, teams | — |

## 12. Metrics
Activation (provider validated + first session ≤24 h, target 40%) · sessions/user/wk ≥5 retained · % sessions → commit/PR ≥60% · time-to-first-token p50 <10 s warm · endpoint-attributable failure rate (messaged as *your endpoint*, never silent) · free→paid 8–12% · COGS ratio <20% on Fly · churn.

## 13. Risks
Endpoint quality variance (conformance suite, loud endpoint-error messaging) · Fly reliability incidents (SandboxProvider failover to Daytona/E2B) · Fly pricing changes — snapshot fees Jan 2026, inter-region private network fees Feb 2026 (single-region default; budget alarms) · App Review (precedents cited; server-side exec) · prompt injection (egress allow-list, redaction, gating) · OpenCode upstream churn (pinned vendored fork) · runaway agents (budgets, reaper) · niche TAM (community-led GTM, founding-member pricing).

## 14. Open Questions
1. Suspend vs stop threshold tuning (resume latency vs RAM-hold cost) — measure in Phase 0.
2. `/v1/models` discovery sandbox-side only (privacy) vs proxied (telemetry) — leaning sandbox-side.
3. iOS 17 vs 16 floor. 4. Claude Code as second engine at launch (licensing review). 5. Preview URLs: Fly proxy vs Cloudflare tunnel per session.

---

## Appendix A — Event schema
```jsonc
{ "id":"evt_01H…","session_id":"ses_…","seq":142,"ts":"2026-07-05T18:22:31Z",
  "type":"tool_call",  // assistant_text|plan_update|tool_call|file_diff|question|test_run|commit|usage|error|state_change
  "payload":{"tool":"bash","command":"npm test","exit_code":0,"output_ref":"art_…","duration_ms":8412} }
```

## Appendix B — Provider config
```jsonc
{ "name":"Umans Code Plan","base_url":"https://api.code.umans.ai/v1",
  "dialect":"openai-chat","auth":{"type":"bearer","key_ref":"sec_…"},
  "models":[
    {"id":"umans-kimi-k2.7","role":"coder","context":128000,"tool_calls":true},
    {"id":"umans-flash","role":"utility","context":128000,"tool_calls":true}],
  "quirks":{"parallel_tool_calls":false} }
```
