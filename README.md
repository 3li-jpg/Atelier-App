# Atelier

Agentic coding from any browser (installable PWA, desktop + mobile) against **your own** model endpoints — agents run in Firecracker microVMs on your Fly.io account. Open source; self-hosting is a first-class path. See `Atelier-PRD-v2.md` (spec — note the PWA pivot in `handoff.md` supersedes its iOS sections), `Atelier-Setup-Implementation-Guide.md` (how), and `handoff.md` (current state + remaining plan).

## Layout

```
runner/            atelier-runner image: Dockerfile, supervisor.sh, firewall.sh
apps/api/          control plane: Hono + node:sqlite, FSM orchestrator, SSE event stream
packages/schema/   zod schemas: events, session FSM, provider config
packages/sandbox/  SandboxProvider interface + FlyMachinesProvider
infra/             fly.toml files
```

## Run locally

```bash
npm install
npm test                      # schema FSM, fly client, full API lifecycle
MASTER_KEY=dev npm run dev    # API on :3000
```

Local API without Fly credentials will fail sessions at `provisioning` (by design — no sandbox). Everything else (providers, validation, events, SSE stream) works.

## Phase 0 spike (needs your accounts)

1. `brew install flyctl && fly auth login` — add a card, then:
   ```bash
   fly apps create atelier-sandboxes
   cd runner && fly deploy --build-only --push -a atelier-sandboxes --image-label runner-v0
   ```
2. Boot one machine by hand per guide §1.2 (curl to api.machines.dev) with your
   Umans key + a fine-grained GitHub PAT. Exit criteria: a real PR on GitHub.
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
| node:sqlite + in-process EventEmitter | >1 API instance → Postgres (Neon) + Redis Streams |
| SSE instead of WebSocket | never, probably — native EventSource is all the PWA needs |
| Static bearer auth (AUTH_TOKEN) | before other users → GitHub OAuth + per-user row scoping (handoff T3) |
| Single MASTER_KEY AES-GCM | before storing others' keys → KMS envelope encryption |
| Firewall resolves IPs once at boot | long sessions hit CDN rotation → dynamic sets |
| openai-chat dialect only | first anthropic-messages provider |

## License

MIT — see [LICENSE](LICENSE). Self-hosting is encouraged.

## Not built yet

Web app / PWA (`apps/web` — replaces the guide's iOS §3), GitHub App integration (§2.7), supervisor↔harness reply channel, conformance suite (§4), Stripe billing. Full list: `handoff.md`.
