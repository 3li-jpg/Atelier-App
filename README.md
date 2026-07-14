# Atelier

Atelier is an open-source, chat-first agentic coding platform. You connect a model API key, pick a repo, and an agent runs in an isolated sandbox — editing files, running tools, and shipping a pull request while you watch a live workspace. It is self-hostable, installable as a PWA, and built so the free plan costs the operator nothing: users bring their own model key (BYOK) and their own compute credits (BYOC).

- **Chat workspaces on your repos** — a workspace is a persistent chat against a cloned repo. Each message drives the agent one turn; the timeline streams assistant text, tool calls, file diffs, todos, subagent activity, and approvals.
- **BYOK any endpoint** — any OpenAI- or Anthropic-compatible endpoint. Built-in presets for Umans, OpenRouter, Anthropic, OpenAI, and GLM; a custom field for anything else. Keys are encrypted at rest, never placed in sandbox machine env.
- **BYOC free plan** — bring your own E2B or Daytona credits and Atelier runs your agent sandbox on them. No operator-hosted compute required for the free tier.
- **Subagents, todos, skills via OpenCode CLI** — the agent runtime is [OpenCode](https://opencode.ai) (installed via `curl -fsSL https://opencode.ai/install | bash`), exposing toolsets including `delegation` (parallel subagents), `todo`, `skills`, `memory`, `browser`, and `search`.
- **PWA, mobile-first** — installable, offline-capable service worker, responsive from phone to desktop.
- **Ships PRs** — on completion the supervisor commits to an `atelier/<ts>` branch and pushes via a per-session git token, then emits a `commit` event.

## Architecture

```
┌──────────────┐        ┌──────────────────┐        ┌─────────────────────┐
│  web PWA     │  SSE   │  control plane   │  HTTPS  │  sandbox providers  │
│  apps/web    │◄──────►│  apps/api        │◄───────►│  packages/sandbox   │
│  Vite+React  │        │  Hono + sqlite|pg│         │  E2B | Daytona |    │
│  (:5173)     │        │  (:3000)         │         │  Fly | local        │
└──────────────┘        └────────┬─────────┘         └──────────┬──────────┘
                                 │ sealed-box handshake          │ spawns
                                 ▼                               ▼
                        ┌──────────────────┐        ┌─────────────────────┐
                        │  runner (sandbox │        │  OpenCode CLI       │
                        │  image)          │        │  opencode serve     │
                        │  runner/         │◄──────►│  127.0.0.1:4096     │
                        │  supervisor.sh   │  SSE   └─────────────────────┘
                        │  opencode-bridge │
                        │  firewall.sh     │
                        └──────────────────┘
```

- **Landing** — the marketing site lives in its own private repo ([Atelier-Landing](https://github.com/3li-jpg/atelier-landing)); its CTAs link into this app. Sign-in/sign-up happens in the PWA itself.
- **Web PWA** (`apps/web`) — Vite + React 18 single-page app: onboarding, session list, provider settings, and the chat workspace (timeline + replies rail). Dev server on `:5173` proxies API paths to `:3000` so the SPA is same-origin with the API in dev. In production the API serves the built bundle from one origin (`WEB_DIST`).
- **Control plane** (`apps/api`) — Hono service on `:3000`. Session FSM orchestrator, store (SQLite via `node:sqlite`, or Postgres/Supabase when `DATABASE_URL` is set), AES-256-GCM secret encryption, SSE event fanout with cursor replay, and auth (session cookie, static bearer, or Supabase JWT). Route surface: `/auth/*`, `/providers`, `/sessions`, `/repos`, `/account`, plus `/internal/*` for the sandbox supervisor.
- **Sandbox providers** (`packages/sandbox`) — one `SandboxProvider` interface, four implementations: Fly Machines, E2B, Daytona, and a local subprocess. `SANDBOX_PROVIDER` selects the default; per-user BYOC keys override it per session.
- **Runner** (`runner/`) — the sandbox image (Ubuntu 24.04 + Node 22 + OpenCode CLI). `supervisor.sh` is PID 1: it clones the repo, raises an nftables egress allowlist (`firewall.sh`), writes opencode config to tmpfs, launches `opencode serve`, and runs `opencode-bridge.mjs` to relay the agent's SSE events to the control plane and inject user replies.

## Local development

Requires Node 18+ (tested on 22) and npm 10+. For `SANDBOX=local` mode you also need the `opencode` CLI installed (`curl -fsSL https://opencode.ai/install | bash`).

```bash
# 1. Install (npm workspaces — not pnpm)
npm install

# 2. Env vars
cp .env.example .env
#   At minimum set MASTER_KEY (encrypts stored provider keys).
#   For local sandboxes set SANDBOX_PROVIDER=local (or SANDBOX=local).

# 3. API on :3000  (reads ../../.env and ../../.env.fly automatically)
npm run dev

# 4. PWA on :5173  (proxies /auth /sessions /providers /repos /account /internal to :3000)
npm run dev:web
```

Open `http://localhost:5173`. With no `AUTH_TOKEN` and no OAuth configured, the API runs open (owner-alpha mode); set `AUTH_TOKEN` for a single-user bearer gate, or configure GitHub OAuth for multi-user.

`SANDBOX_PROVIDER=local` runs the supervisor as a local subprocess via the installed `opencode` CLI — no Fly account, no microVM isolation, no suspend/resume. The firewall is skipped on macOS/local runs (`SKIP_FIREWALL=1` is set by the local provider).

## Sandbox providers

`SANDBOX_PROVIDER` selects the substrate. Per-user BYOC keys (E2B or Daytona, set via Settings → Account) override it for that user's sessions.

| Provider | Env vars | Status |
|----------|----------|--------|
| `fly` (default) | `FLY_SANDBOX_APP`, `FLY_SANDBOX_TOKEN`, `RUNNER_IMAGE` | Battle-tested path. Real Fly Machines API client (`api.machines.dev`); used for all alpha sessions. |
| `e2b` | `E2B_API_KEY` | Adapter implemented (`packages/sandbox/src/e2b.ts`); validated with mocked-fetch tests only. Real-API validation pending. |
| `daytona` | `DAYTONA_API_KEY`, `DAYTONA_WORKSPACE_ID` | Adapter implemented (`packages/sandbox/src/daytona.ts`); validated with mocked-fetch tests only. Real-API validation pending. |
| `local` | `SANDBOX=local` or `SANDBOX_PROVIDER=local` | Runs supervisor as a host subprocess; requires the `opencode` CLI. No isolation, no suspend/resume. Dev only. |

The API warns at boot if the selected provider's key is missing. BYOC keys are stored encrypted (same AES-256-GCM path as model keys) and decrypted only inside the sealed-box handshake.

## Security model

- **Keys encrypted at rest.** Provider API keys and BYOC compute keys are AES-256-GCM encrypted under `MASTER_KEY` before storage (`apps/api/src/secrets.ts`). The plaintext is never logged.
- **Sealed-box handshake.** Secrets never sit in sandbox machine env. The supervisor generates an X25519 keypair, posts its pubkey to `/internal/sessions/:id/handshake`, and the control plane replies with the full session config (repo, model key, git token) AES-256-GCM-encrypted under the ECDH shared secret. The machine env carries only `SESSION_ID`, `HANDSHAKE_URL`, `EVENTS_URL`, and a per-session bearer.
- **Egress allowlist.** `runner/firewall.sh` installs an nftables default-drop output policy allowing only DNS and HTTPS to a resolved host list (the model endpoint, GitHub, the control plane). Fail-closed: if `nft` fails to apply, the session never starts.
- **Tokens scrubbed from the supervisor.** After the handshake, `GIT_TOKEN` and `LLM_API_KEY` are `unset` from PID 1's env. The git push token lives in tmpfs (`/dev/shm`) and is shredded after use; opencode config (which holds the model key) is written to a tmpfs `OPENCODE_CFG`.
- **Streamed output redacted.** Events posted back through `/internal/sessions/:id/events` are passed through a `redact()` filter that strips known secret patterns (`sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, etc.) before persistence.

## Roadmap

- **Hosted compute plans** — operator-run Fly/E2B capacity for paid tiers, so users don't need their own credits.
- **Real-API BYOC validation** — exercise the E2B and Daytona adapters against live APIs; today they are covered by mocked-fetch unit tests only.
- **Deep links / routing** — shareable workspace URLs and stable client-side routing.
- **PWA push notifications** — agent completions and approval requests delivered to installed clients.

## License

MIT — see [LICENSE](LICENSE). Self-hosting is encouraged.
