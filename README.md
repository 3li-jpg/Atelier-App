# Atelier

Agentic coding from any browser (installable PWA, desktop + mobile) against **your own** model endpoints — agents run in Firecracker microVMs on your Fly.io account. Open source; self-hosting is a first-class path. See `Atelier-PRD-v2.md` (spec — note the PWA pivot in `handoff.md` supersedes its iOS sections), `Atelier-Setup-Implementation-Guide.md` (how), and `handoff.md` (current state + remaining plan).

## Layout

```
runner/              atelier-runner image: Dockerfile, supervisor.sh (opencode-serve bridge), firewall.sh, bridge.mjs
apps/api/            control plane: Hono + node:sqlite, FSM orchestrator, SSE stream, GitHub OAuth + per-user scoping
apps/web/            installable PWA: Vite + React (sessions, chat timeline, NewTask, providers, cancel, workspace, finish)
apps/workspace-proxy/  cookie-routing reverse proxy (HTTP+WS) to per-session sandbox machines over Fly 6PN
packages/schema/     zod schemas: events, session FSM, provider config
packages/sandbox/    SandboxProvider interface + FlyMachinesProvider (+ orphan scan)
packages/conformance/  provider scoring: tool-call fidelity, edit reliability, streaming stability
infra/               fly.toml files
```

## Run locally

```bash
npm install
npm test                       # 45 tests across api/web/workspace-proxy/sandbox/schema/conformance
MASTER_KEY=dev npm run dev    # API on :3000
npm run dev:web                # PWA on :5173 (proxies API calls to :3000)
```

Local API without Fly credentials will fail sessions at `provisioning` (by design — no sandbox). Everything else (providers, validation, events, SSE stream, auth) works. Without `AUTH_TOKEN`/OAuth configured the API runs open (owner-alpha); set `AUTH_TOKEN` for a single-user gate, or GitHub OAuth creds for real auth.

## Phase 0 spike (needs your accounts)

1. `brew install flyctl && fly auth login` — add a card, then:
   ```bash
   fly apps create atelier-sandboxes
   cd runner && fly deploy --build-only --push -a atelier-sandboxes --image-label runner-v2
   ```
2. Boot one machine by hand per guide §1.2 (curl to api.machines.dev) with your
   Umans key + a fine-grained GitHub PAT. Exit criteria: a real PR on GitHub.
   (This also verifies the supervisor bridge against a real `opencode serve`.)
3. Measure suspend→start latency (guide §1.3) — this tunes hibernation policy.
4. Run the control plane against real Fly:
   ```bash
   MASTER_KEY=... FLY_SANDBOX_TOKEN=$(fly tokens create deploy -a atelier-sandboxes) \
   GIT_TOKEN=ghp_... PUBLIC_URL=https://your-tunnel npm run dev
   ```
   (`PUBLIC_URL` must be reachable from the machine for event ingest — use a
   tunnel locally, or deploy: `fly deploy -c infra/fly.api.toml`.)

## Deliberate simplifications (ponytail: markers in code)

| Shortcut | Upgrade when |
|---|---|
| node:sqlite + in-process EventEmitter + in-memory timers | >1 API instance → Postgres (Neon) + Redis Streams |
| SSE instead of WebSocket | never, probably — native EventSource is all the PWA needs |
| Stateless session cookie (no revocation) | before public launch → server-side sessions table for revocation |
| Single MASTER_KEY AES-GCM | before storing others' keys → KMS envelope encryption |
| Firewall resolves IPs once at boot | long sessions hit CDN rotation → dynamic sets |
| Prefix-only secret redaction | if a leak slips past → add a high-entropy heuristic |
| openai-chat dialect only | first anthropic-messages provider |
| `opencode serve` bridge event shapes assumed | verify against a real run (T1), then harden |
| Cookie-routing proxy (one workspace per browser) | per-session subdomains on a custom domain |

## License

MIT — see [LICENSE](LICENSE). Self-hosting is encouraged.

## Status

Most of the plan is implemented (see `handoff.md` for per-task status). Still open: Fly deploy (🔑), GitHub App repo/branch listing + webhooks (🔑 registration), Web Push notifications (VAPID 🔑), Stripe billing, and verifying the supervisor bridge against a real `opencode serve` run (T1 spike 🔑).
