# Contributing to Atelier

Atelier is open source and self-hostable. Thanks for considering a contribution.

## Setup

```bash
git clone <repo> && cd atelier
npm install            # npm workspaces — not pnpm
npm test               # node --test across packages; must pass before any commit
MASTER_KEY=dev npm run dev   # API on :3000
```

Requires Node 18+ (tested on 22). The API runs with `--experimental-strip-types`.

## Where things are

- `runner/` — the sandbox image (Dockerfile, supervisor, egress firewall).
- `apps/api/` — control plane (Hono + node:sqlite, orchestrator FSM, SSE stream).
- `packages/schema/` — zod schemas (events, session FSM, provider config).
- `packages/sandbox/` — `SandboxProvider` interface + Fly Machines client.
- `infra/` — fly.toml files.

See `README.md` for the deliberate-shortcut table and current status.

## Conventions

- **npm workspaces**, not pnpm. Node 24, `--experimental-strip-types` — no
  constructor parameter properties, no enums, no decorators (strip-only mode rejects them).
- **Tests:** `node --test`, no framework. One integration-style test per package,
  fakes over mocks (see `apps/api/src/api.test.ts` `FakeSandbox`).
- **SSE** (not WebSocket) for the event stream, with cursor replay via `?cursor=N`.
- **Ponytail style:** the minimum code that works. Deliberate shortcuts carry a
  `ponytail:` comment naming the ceiling and upgrade path. Don't upgrade early —
  honor the "upgrade when" triggers in the README table.
- **Security is never a ponytail shortcut:** egress allow-list, secret redaction,
  budget kill-switches, and key handling stay full-strength (PRD §9).
- **Commits:** what changed + why, imperative subject (e.g. `91f789e`). Run
  `npm test` before every commit.
- **Docs vs reality:** when a doc disagrees with observed reality (Fly API drift,
  flag changes), trust reality and fix the doc in the same commit.

## Adding a provider

Add a `provider` dialect in `packages/schema/` and an adapter in the runner
supervisor. Wire presets through the conformance suite (`packages/conformance/`,
handoff T8) so tool-call fidelity is scored before the preset ships.

## Reporting security issues

Do not open a public issue for security vulnerabilities. See the contact path in
`README.md` (or `handoff.md` §4) until a dedicated `SECURITY.md` exists.
