# Atelier — Developer Setup & Implementation Guide

From zero to "GLM 5.2 ships a PR from my phone." Companion to `Atelier-PRD-v2.md`. Ordered as you should actually build it: Phase 0 spike first, control plane second, iOS app third.

> Commands and API shapes below match Fly.io as of mid-2026 — verify flags against `fly help` / docs.machines.dev when you run them, as CLIs drift.

---

## 0. Prerequisites & Accounts

```bash
# Tooling
brew install flyctl gh node@22 terraform
npm i -g pnpm
# Accounts you need
# - fly.io (add card; create TWO orgs or at least two apps: atelier-api, atelier-sandboxes)
# - github.com — you'll register a GitHub App later
# - neon.tech (Postgres) and upstash.com (Redis) free tiers
# - Apple Developer ($99/yr) — needed for Phase 1, not Phase 0
# - Your inference plan (e.g. code.umans.ai) with an API key

fly auth login
fly orgs create atelier            # or use personal org for the spike
```

Repo layout (monorepo, pnpm workspaces):

```
atelier/
├── apps/
│   ├── api/            # Hono control plane + orchestrator + WS
│   └── ios/            # SwiftUI app (Xcode project)
├── packages/
│   ├── schema/         # zod event/provider/session schemas, shared types
│   └── sandbox/        # SandboxProvider interface + FlyMachines impl
├── runner/             # atelier-runner Docker image + supervisor
├── infra/              # terraform + fly.toml files
└── docs/
```

---

## 1. Phase 0 Spike — an agent in a Fly Machine, on your endpoint

Goal: prove the whole chain with zero product code: **Fly Machine → OpenCode headless → api.code.umans.ai → real PR.**

### 1.1 The runner image (minimal spike version)

`runner/Dockerfile`:

```dockerfile
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git curl ripgrep build-essential ca-certificates jq \
    nodejs npm python3 python3-pip nftables openssh-client \
 && rm -rf /var/lib/apt/lists/*
# OpenCode (pin an exact version — treat as vendored dependency)
RUN curl -fsSL https://opencode.ai/install | bash \
 && ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode
WORKDIR /workspace
COPY supervisor.sh /usr/local/bin/supervisor
RUN chmod +x /usr/local/bin/supervisor
ENTRYPOINT ["/usr/local/bin/supervisor"]
```

`runner/supervisor.sh` (spike version — the real one becomes a Go/TS binary):

```bash
#!/usr/bin/env bash
set -euo pipefail
# Config arrives as env vars injected at machine-create time (spike only;
# production uses a sealed-box exchange instead — see §4.3)
: "${REPO_URL:?}" "${BRANCH:=main}" "${TASK:?}"
: "${LLM_BASE_URL:?}" "${LLM_API_KEY:?}" "${LLM_MODEL:?}" "${GIT_TOKEN:?}"

# 1. Egress allow-list (endpoint + github + npm; everything else dropped)
bash /usr/local/bin/firewall.sh "$LLM_BASE_URL" github.com registry.npmjs.org

# 2. Clone
git clone --depth 50 --branch "$BRANCH" \
  "https://x-access-token:${GIT_TOKEN}@${REPO_URL#https://}" /workspace/repo
cd /workspace/repo

# 3. Point OpenCode at the custom endpoint (OpenAI-compatible provider)
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode.json <<EOF
{
  "provider": {
    "custom": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "${LLM_BASE_URL}", "apiKey": "${LLM_API_KEY}" },
      "models": { "${LLM_MODEL}": { "name": "${LLM_MODEL}" } }
    }
  },
  "model": "custom/${LLM_MODEL}"
}
EOF

# 4. Run the task headless; JSON events to stdout (Fly captures logs)
opencode run --format json "$TASK" | tee /workspace/events.jsonl

# 5. Ship it
git checkout -b "atelier/$(date +%s)"
git add -A && git commit -m "Atelier: ${TASK:0:60}" && git push -u origin HEAD
```

Build and push to Fly's registry:

```bash
cd runner
fly apps create atelier-sandboxes
fly deploy --build-only --push -a atelier-sandboxes \
  --image-label runner-v0
# → registry.fly.io/atelier-sandboxes:runner-v0
```

### 1.2 Boot one Machine by hand

The Machines REST API is the core primitive you'll orchestrate with. Spike it with curl:

```bash
export FLY_TOKEN=$(fly tokens create deploy -a atelier-sandboxes)

curl -s -X POST "https://api.machines.dev/v1/apps/atelier-sandboxes/machines" \
  -H "Authorization: Bearer $FLY_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "spike-1",
    "region": "sea",
    "config": {
      "image": "registry.fly.io/atelier-sandboxes:runner-v0",
      "guest": { "cpu_kind": "shared", "cpus": 2, "memory_mb": 4096 },
      "auto_destroy": true,
      "restart": { "policy": "no" },
      "env": {
        "REPO_URL": "https://github.com/you/test-repo",
        "BRANCH": "main",
        "TASK": "Add input validation to the signup form and update the tests",
        "LLM_BASE_URL": "https://api.code.umans.ai/v1",
        "LLM_API_KEY": "<your umans key>",
        "LLM_MODEL": "umans-kimi-k2.7",
        "GIT_TOKEN": "<a fine-grained PAT for the test repo>"
      }
    }
  }'

fly logs -a atelier-sandboxes        # watch the agent work
```

**Exit criteria for the spike:** PR appears on GitHub; `events.jsonl` shows sane tool-calling; note wall-clock and where the time went (model latency vs npm install vs tests). Run it 5–10 times across `umans-kimi-k2.7`, `umans-coder`, and one OpenRouter model to feel the variance — this data tunes your hibernation thresholds and conformance suite.

### 1.3 Spike the lifecycle verbs you'll build the FSM on

```bash
MID=<machine id from create response>
B="https://api.machines.dev/v1/apps/atelier-sandboxes/machines/$MID"
A="Authorization: Bearer $FLY_TOKEN"

curl -X POST "$B/suspend" -H "$A"    # RAM snapshot — this is 'hibernated'
curl -X POST "$B/start"   -H "$A"    # resume from suspend (measure latency!)
curl -X POST "$B/stop"    -H "$A"    # rootfs only, $0.15/GB/mo — deep sleep
curl -X DELETE "$B?force=true" -H "$A"  # end of session
```

Measure suspend→start resume time in your region. That number decides your suspend-vs-stop policy (PRD Open Question #1).

---

## 2. Control Plane (`apps/api`)

### 2.1 Stack & skeleton

Hono + Node 22 + TypeScript. Modules:

```
src/
├── index.ts            # Hono app: REST + WS upgrade
├── auth/               # Sign in with Apple + GitHub OAuth, session JWTs
├── providers/          # CRUD + validation runner (test completion + tool-call probe)
├── repos/              # GitHub App install, repo/branch listing, env config
├── sessions/           # create/list/steer/stop endpoints
├── orchestrator/       # the heart: FSM + Machines client + budgets + reaper
│   ├── fsm.ts
│   ├── fly.ts          # SandboxProvider impl over api.machines.dev
│   ├── hibernation.ts
│   └── reaper.ts       # BullMQ repeatable job: TTL enforcement
├── events/             # append to PG, fan out via Redis Streams, WS replay
├── notify/             # APNs
└── billing/            # RevenueCat webhooks, quota accounting (sandbox-seconds)
```

### 2.2 Data model (Postgres)

```sql
create table users (id uuid pk, apple_sub text, github_id bigint, tier text, created_at timestamptz);
create table providers (id uuid pk, user_id uuid, name text, base_url text,
  dialect text, key_ciphertext bytea, quirks jsonb, created_at timestamptz);
create table provider_models (id uuid pk, provider_id uuid, model_id text,
  role text check (role in ('coder','utility')), context int, tool_calls bool);
create table repos (id uuid pk, user_id uuid, gh_installation_id bigint,
  full_name text, image_variant text, setup_script text, snapshot_machine_id text);
create table sessions (id uuid pk, user_id uuid, repo_id uuid, provider_id uuid,
  model_id text, state text, machine_id text, region text, permission_mode text,
  budgets jsonb, started_at timestamptz, ended_at timestamptz, billed_seconds int);
create table events (id bigserial pk, session_id uuid, seq int, type text,
  payload jsonb, ts timestamptz, unique(session_id, seq));
create table secrets (id uuid pk, user_id uuid, scope text, ciphertext bytea, kms_key_id text);
```

Quota accounting = sum of `billed_seconds` per user per month; the orchestrator writes deltas at every start/suspend/stop transition (Fly bills per second only while `started`, so your meter mirrors your bill).

### 2.3 The SandboxProvider interface (do not skip this)

```ts
// packages/sandbox/src/types.ts
export interface SandboxProvider {
  create(cfg: SandboxCreateConfig): Promise<SandboxRef>;
  exec(ref: SandboxRef, cmd: string[]): Promise<ExecResult>;   // sealed-box handshake, health
  suspend(ref: SandboxRef): Promise<void>;
  resume(ref: SandboxRef): Promise<void>;
  stop(ref: SandboxRef): Promise<void>;
  destroy(ref: SandboxRef): Promise<void>;
  status(ref: SandboxRef): Promise<SandboxState>;
}
// implementations: FlyMachinesProvider (v1), DaytonaProvider (failover, v1.5)
```

`FlyMachinesProvider` is a thin typed client over `api.machines.dev` (create with `guest {shared, 2, 4096}`, `auto_destroy: true`, per-session metadata labels; poll `/wait?state=started`; suspend/start/stop/delete as in §1.3).

### 2.4 Session FSM (happy path)

```
POST /sessions
 → state=provisioning   fly.create() from repo snapshot image (warm) or base variant (cold)
 → state=cloning/setup  supervisor reports via event channel
 → state=running        harness streams events → orchestrator appends → Redis → WS
 → on `question` event  state=awaiting_user → push APNs → hibernation.suspend() after 30s
 → user replies         resume() → deliver message to harness → running
 → harness done         state=finalizing → diff/PR handled → artifacts to R2
 → destroy() (or stop() if repo has snapshots enabled) → completed
Budgets: wall-clock timer + turn counter enforced by supervisor AND orchestrator (belt & braces).
Reaper: any machine older than max TTL, or suspended >10 min, or orphaned → stop/destroy + alert.
```

### 2.5 Event transport

- Supervisor → orchestrator: outbound HTTPS POST batches to `https://api.atelier.dev/internal/sessions/:id/events` with a per-session bearer token (simplest; no inbound connections to machines needed). Fallback/scale option: Redis Stream the machine writes to over Fly private networking (6PN) — decide after spike latency data.
- Orchestrator → phone: WS `GET /sessions/:id/stream?cursor=N`; replays `events` rows > cursor, then live-tails the Redis stream. Client reconnects are free.

### 2.6 Secrets flow (production, replaces spike env vars)

1. User saves provider key → API encrypts with per-user KMS data key → `secrets` table.
2. Session create → orchestrator generates ephemeral X25519 keypair, passes **public** key in machine env.
3. Supervisor boots, requests config: POST `/internal/sessions/:id/handshake` with its own pubkey.
4. Orchestrator seals `{llm_key, git_token, task, config}` to the supervisor's key (libsodium sealed box) → supervisor decrypts in memory, never writes to disk, scrubs from env.
5. All streamed output passes a redaction filter (known prefixes: `sk-`, `ghp_`, `github_pat_`, plus entropy scan).

### 2.7 GitHub App

Register at github.com/settings/apps: permissions `contents:rw`, `pull_requests:rw`, `metadata:r`; webhook → `/webhooks/github` (installation events, PR check results → push notifications). Per session: mint an installation access token scoped to the one repo (expires in 1 h — matches session budgets nicely).

### 2.8 Deploy the control plane

`infra/fly.api.toml`:

```toml
app = "atelier-api"
primary_region = "sea"
[build]
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1
[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

```bash
fly deploy -c infra/fly.api.toml
fly secrets set -a atelier-api DATABASE_URL=... REDIS_URL=... KMS_KEY_ID=... \
  FLY_SANDBOX_TOKEN=... APNS_KEY=... GITHUB_APP_ID=... GITHUB_APP_PK=...
```

---

## 3. iOS App (`apps/ios`)

### 3.1 Targets & structure

```
Atelier/
├── App/                # entry, DI, deep links
├── Features/
│   ├── Sessions/       # list, session view (Chat/Changes/Terminal/Preview tabs)
│   ├── NewTask/        # repo→branch→provider→prompt sheet, voice input
│   ├── Providers/      # add/edit/validate
│   ├── Repos/          # env config
│   └── Settings/       # account, usage meter, retention
├── Core/
│   ├── APIClient/      # OpenAPI-generated
│   ├── EventStream/    # WS actor, cursor persistence, replay merge
│   ├── EventStore/     # GRDB cache of events per session
│   └── Push/           # APNs registration, deep-link routing
├── UI/                 # DiffView (TreeSitter), TerminalView (SwiftTerm), timeline cells
└── LiveActivity/       # widget extension: session status
```

### 3.2 The three hard views (budget your time here)

1. **Timeline (Chat tab):** a `List` of typed event cells; `tool_call` cells collapsed with exit-code badge, expandable to output; `question` events render inline quick-reply chips + text field pinned above keyboard. Stream via an `AsyncStream<Event>` actor that merges WS live events with GRDB-cached replay so scrollback is instant on reopen.
2. **DiffView:** parse unified diffs server-side into a JSON hunk model (do not parse on device); render with TreeSitter highlighting; long-press a hunk → "steer about this" prefills the composer with file/hunk reference.
3. **TerminalView:** SwiftTerm fed by `tool_call` output events; a manual input row POSTs `/sessions/:id/exec` (Pro+).

### 3.3 Ambient layer

- APNs: needs-input (interruption-level: time-sensitive), completed, failed. Payload carries `session_id` + `event_seq` → deep link opens the session scrolled to that event.
- Live Activity: state chip + elapsed + model name; updated via push token channel from the notify worker.
- App Intents: "Start an Atelier task" Siri shortcut → NewTask sheet with dictation active.

### 3.4 Paywall & billing

RevenueCat SDK; entitlements `pro`, `power`. Contextual paywall triggers: hitting concurrent-session cap mid-flow, cold-start wait screen ("Pro starts in ~10 s"), history beyond 7 days. US builds add the external Stripe checkout link (same prices) per the external-link entitlement rules.

---

## 4. Conformance Suite (gate every provider preset)

A repeatable script that runs against any base URL + key and scores:

1. **Tool-call fidelity:** 20 canned prompts requiring bash/edit tool calls; score malformed/dropped calls.
2. **Edit reliability:** apply-patch task on a fixture repo; diff must apply cleanly.
3. **Long-context:** 60k-token repo summary + targeted edit.
4. **Streaming stability:** detect stalls >30 s, malformed SSE.
5. **End-to-end:** the Phase 0 spike task; must produce a mergeable PR.

Presets ship only with a passing score + a quirks JSON (e.g., `parallel_tool_calls:false`). Run nightly against Umans/OpenRouter/Together — providers change models under stable aliases (Umans explicitly routes `umans-coder` to whatever wins their evals), so yesterday's pass is not today's.

---

## 5. Launch Checklist

- [ ] Reaper + budget kill-switches verified with chaos tests (kill orchestrator mid-session → machine still dies on TTL)
- [ ] Redaction filter fuzzed with real key formats
- [ ] Egress firewall verified: `curl evil.example` from inside a session fails
- [ ] Soft-cap → throttle/overage path tested end-to-end with RevenueCat sandbox
- [ ] App Review notes: cite server-side execution precedents; demo account with a preloaded provider (your Umans key on a burner account? No — create a cheap OpenRouter key for review)
- [ ] Status page + endpoint-error messaging ("Your endpoint returned 429" — never let a provider failure read as an Atelier failure)
- [ ] Fly reserved blocks purchased once steady-state concurrency is known (−40%)
- [ ] Founding-member pricing flag + Show HN draft ready

---

## 6. Build Order Summary (what to do tomorrow)

1. Write `runner/Dockerfile` + spike supervisor → `fly deploy --build-only --push`.
2. Boot one machine with your Umans key via curl (§1.2). Get a PR merged. Celebrate.
3. Measure suspend/resume latency (§1.3) → pick hibernation thresholds.
4. Scaffold `apps/api` (Hono, Neon, Upstash) → sessions FSM + events + WS.
5. Replace env-var secrets with the sealed-box handshake (§2.6).
6. SwiftUI shell: Sessions list + Chat timeline + push. Ship a PR from the phone.
7. Everything else in the PRD's Phase 2–3 order.
