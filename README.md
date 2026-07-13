# Atelier

Agentic coding from any browser. Bring your own model key (BYOK), an agent runs in a cloud sandbox, edits your repo, and opens a PR. Installable PWA — works on desktop and mobile.

## What is Atelier?

Atelier is a self-hostable, agentic coding platform. You connect your own model API key (Umans, OpenRouter, Anthropic, OpenAI, GLM, or any OpenAI-compatible endpoint), pick a repo, describe a task, and the agent gets to work in an isolated sandbox — building, testing, and shipping a PR while you watch the live workspace.

**Key features:**
- **BYOK** — no hardcoded provider keys. Bring your own (Umans, OpenRouter, Anthropic, OpenAI, GLM, or custom).
- **Multi-model per provider** — configure multiple models (coder + utility) per provider, switch between them per session.
- **IDE-lite workspace** — three-panel layout: file tree (changed files with A/M/D badges), diff viewer (unified diff with syntax colors + line numbers), and chat/tool activity feed with streaming, inline approvals, and PR status.
- **Guided onboarding** — signup → connect model key (with presets + test key) → pick repo (searchable GitHub dropdown) → describe task → land in live workspace. Under 60 seconds.
- **Violet "midnight terminal" design system** — dark, high-contrast, Framer Motion animations, fully accessible (ARIA roles, keyboard nav, reduced-motion support).
- **Installable PWA** — add to home screen, works offline (service worker), responsive on mobile and desktop.
- **Multi-provider sandbox** — Fly.io (Firecracker microVMs), Daytona, E2B, or local.
- **Supabase Auth** — email/password + GitHub OAuth.

## Monorepo layout

```
apps/landing/           Next.js 15 + React 19 marketing site + Supabase auth (GitHub OAuth + email/password)
apps/web/               Vite + React 18 PWA — the dashboard + workspace (onboarding, sessions, providers, IDE-lite session view)
apps/api/               Hono control plane — FSM orchestrator, store (sqlite/Postgres/Supabase), AES-GCM secrets, SSE event fanout, auth
apps/workspace-proxy/   reverse proxy to per-session sandboxes
packages/schema/        zod schemas — events, session FSM, provider config (source of truth)
packages/sandbox/       SandboxProvider interface + Fly/Daytona/E2B/local providers
packages/ui/            shared component library — Button, Input, Card, Badge, Skeleton, Tabs, Toast + violet design tokens
packages/conformance/   provider scoring — tool-call fidelity, edit reliability, streaming stability
runner/                 sandbox image — supervisor.sh, hermes-bridge.mjs, map-event.mjs, firewall.sh
infra/                   fly.toml files
```

## Prerequisites

- **Node.js** 18+ (tested on 22/24)
- **npm** 10+
- For sandboxes: a Fly.io account (or Daytona/E2B/local)
- For auth: a Supabase project (optional — runs open in dev without it)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit env vars
cp .env.example .env
# At minimum set MASTER_KEY (used to encrypt stored API keys)

# 3. Start the API (port 3000)
npm run dev

# 4. In another terminal, start the PWA (port 5173)
npm run dev:web

# 5. (Optional) Start the landing page (port 3001)
npm run dev -w @atelier/landing
```

Open `http://localhost:5173` in your browser. The PWA proxies API calls to `:3000` automatically (no CORS config needed in dev).

Without `AUTH_TOKEN` or OAuth configured, the API runs open (owner-alpha mode). Set `AUTH_TOKEN` in `.env` for a single-user gate, or configure GitHub OAuth for real multi-user auth.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need:

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_KEY` | ✅ | Encrypts stored provider API keys (AES-256-GCM) |
| `AUTH_TOKEN` | — | Optional bearer token for single-user auth |
| `SESSION_SECRET` | — | HMAC key for session cookies (defaults to `MASTER_KEY`) |
| `PORT` | — | API port (default 3000) |
| `DB_PATH` | — | SQLite file path (default `atelier.db`) |
| `DATABASE_URL` | — | Postgres URL (e.g. Supabase). Overrides SQLite when set |
| `PUBLIC_URL` | — | API URL reachable from sandbox machines |
| `GITHUB_OAUTH_CLIENT_ID` | — | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | GitHub OAuth app client secret |
| `SANDBOX_PROVIDER` | — | `fly` / `daytona` / `e2b` / `local` (default `fly`) |
| `FLY_SANDBOX_TOKEN` | — | Fly deploy token |
| `DAYTONA_API_KEY` | — | Daytona API key |
| `E2B_API_KEY` | — | E2B API key |
| `GIT_TOKEN` | — | GitHub PAT for the agent to clone/push repos |

## Supported model providers

Atelier supports any OpenAI-compatible or Anthropic-compatible endpoint. Built-in presets:

| Provider | Base URL | Default Model | Dialect |
|----------|----------|---------------|---------|
| **Umans** (default) | `https://api.code.umans.ai` | `umans-glm-5.2` | `openai-chat` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet` | `openai-chat` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-3.5-sonnet` | `anthropic-messages` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | `openai-chat` |
| GLM (Zhipu) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` | `openai-chat` |
| Custom | any | any | any |

Each provider can have multiple models (coder + utility roles). Switch between them when starting a session.

## Testing

```bash
# Unit tests (all workspaces)
npm test

# E2E tests (Playwright — requires the web dev server)
cd apps/web && npx playwright test

# Type check
npx tsc --noEmit -p apps/web/tsconfig.json
```

## Building

```bash
# PWA (code-split, lazy-loaded chunks)
npm run build -w @atelier/web

# Landing page (Next.js)
npm run build -w @atelier/landing
```

## Deploy

The API serves the built PWA bundle from one origin in production (set `WEB_DIST` to the web build output). Deploy to Fly.io:

```bash
fly deploy -c infra/fly.api.toml
```

See `infra/fly.api.toml`, `infra/fly.sandboxes.toml`, and `infra/fly.workspaces.toml` for Fly configuration.

## License

MIT — see [LICENSE](LICENSE). Self-hosting is encouraged.
