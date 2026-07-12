# LOOP_STATE.md — Atelier Autonomous Improvement Loop

> Orchestrator memory across cycles. Read at start, rewrite at end of each cycle.

---

## DEFINITION OF DONE — Current Scores (0–5)

### UNIFICATION
| Item | Score | Notes |
|------|-------|-------|
| One coherent app: signup → dashboard → workspace share one origin/shell, one nav, one design. No jarring hand-off. | 1 | Three separate apps (landing :3001, web :5173, API :3000). Landing redirects to web via URL hash token. Different visual languages. |
| Session/workspace embedded in product shell, not bare proxied iframe. | 2 | SessionView is a React component in the SPA, but the workspace proxy exists separately. No file tree, no IDE layout. |

### ONBOARDING
| Item | Score | Notes |
|------|-------|-------|
| New user reaches first running build in <60s: auth → BYOK → repo → task → workspace. No dead ends. | 1 | No guided flow. User must discover tabs (Providers → New → Session). No progress indicator. |
| First-run guidance: empty states, sample/template task, clear next action. | 1 | Empty states are bare text ("no sessions yet", "add a provider first"). No templates, no guidance. |
| Model/provider setup friendly (presets for GLM/OpenRouter/Anthropic/custom). | 1 | Raw form: name, base_url, dialect, model_id, api_key. No presets, no "test key" inline in onboarding. |

### LOOK & FEEL
| Item | Score | Notes |
|------|-------|-------|
| Violet "midnight terminal" applied consistently across landing + app + workspace. Amber theme gone. | 1 | Landing has violet system. Web app uses openchamber amber oklch(85°) theme. Completely different. |
| Shared component library used everywhere — no one-off styles. | 0 | No shared UI package. Landing uses inline styles + globals.css classes. Web uses styles.css classes. No shared components. |
| Motion: tasteful Framer-Motion transitions, hover/focus micro-interactions, page transitions. | 1 | Landing has Framer Motion. Web app has zero motion — no transitions, no hover animations beyond CSS :hover. |
| Typography + spacing scale from design tokens; strong visual hierarchy. | 1 | Landing has a token system. Web app uses ad-hoc rem/px values. No shared scale. |

### WORKSPACE UX
| Item | Score | Notes |
|------|-------|-------|
| IDE-lite: file tree/changed-files, DiffViewer, tool/terminal feed, run/PR status, inline approval + steering, streaming. | 2 | Has EventCell (timeline), DiffViewer (basic <details>), ToolFeed (collapsible). No file tree, no tabs, no inline approval UI, no PR status, no streaming feel. |

### QUALITY
| Item | Score | Notes |
|------|-------|-------|
| Responsive: great on mobile PWA and desktop. | 2 | Web app is mobile-first narrow layout. Landing has media queries. Neither is polished at both breakpoints. |
| Loading, empty, error, offline states everywhere. Keyboard nav + focus rings. | 1 | Basic "loading…" text. No skeletons. No focus rings in web app. No offline state. |
| Accessible contrast, aria labels, reduced-motion support. | 0 | No aria labels. No reduced-motion. Web app has no focus management. |
| `npm run build` clean, typecheck clean, `npm test` green, e2e green, no console errors. | 2 | Tests pass (48). No e2e. No Playwright. Build not verified this cycle. |
| Perf: fast first paint, no layout shift, lazy-load heavy views. | 1 | No code splitting. No lazy loading. No perf measurement. |

**Overall average: 1.2/5**

---

## PRIORITIZED BACKLOG (ordered by impact on "feels like one polished app")

### HIGH IMPACT
1. **[LANE A] Create packages/ui shared component library** — tokens.css (violet system), Button, Input, Card, Badge, Skeleton, Spinner, Tabs, Toast. Port landing's globals.css tokens into packages/ui/tokens.css. Kill the amber theme in apps/web/src/styles.css. (Files: packages/ui/*, apps/web/src/styles.css, apps/landing/src/styles/globals.css)
2. **[LANE B] Build guided onboarding flow** — multi-step wizard: auth → BYOK (with presets + test key) → repo → task → workspace. Progress indicator. Empty states with templates. (Files: apps/web/src/views/Onboarding.tsx [new], apps/web/src/App.tsx, apps/web/src/views/NewTask.tsx, apps/web/src/views/Providers.tsx)
3. **[LANE C] Upgrade SessionView to IDE-lite workspace** — three-panel layout (file tree | diff/timeline | chat+tools), tabs, inline approval/steering, streaming feel, PR status. (Files: apps/web/src/views/SessionView.tsx, apps/web/src/components/*, apps/web/src/components/FileTree.tsx [new])

### MEDIUM IMPACT
4. Add Framer Motion to web app — page transitions, list stagger, hover micro-interactions, reduced-motion support.
5. Add Playwright e2e test setup — onboarding happy path, mocked session, responsive snapshots.
6. Unify auth flow — make landing→app transition seamless (same origin or invisible handoff).
7. Add command palette (Cmd+K) for navigation.
8. Add aria labels, focus management, keyboard nav across web app.

### LOWER IMPACT
9. Add code splitting / lazy loading for heavy views.
10. Add offline state UI for PWA.
11. Add Lighthouse/perf audit and fix regressions.
12. Add toast notification system for async feedback.

---

## CHANGELOG

### Cycle 1 — Planning + Research
- Deep-researched competitive onboarding (Cursor, Replit, v0, Bolt, Lovable) and look&feel (Framer, Linear, Vercel, Cursor).
- Wrote DESIGN.md with concrete patterns, token spec, component spec, layout spec, motion guidelines.
- Audited repo against DoD: overall score 1.2/5.
- Identified three independent lanes for cycle 1: A (design system), B (onboarding), C (workspace UX).
- Spawning 3 subagents in parallel.

---

## CURRENT DESIGN DECISIONS
- **Unification approach**: For cycle 1, focus on making the web app (dashboard) feel like the landing page by adopting the violet design system. Full origin unification (serving landing + app from one origin) is a later cycle decision.
- **Shared UI package**: Create packages/ui/ with tokens.css + React components. Both landing and web import it.
- **Onboarding**: Build as a multi-step flow within the web app (not landing). After auth, user enters onboarding if no provider is configured.
- **Workspace layout**: Three-panel (file tree | diff/timeline | chat+tools) with responsive collapse on mobile.

---

## KNOWN ISSUES
- Landing uses React 19, web uses React 18. Shared UI package must be compatible with both (peer dep on react ^18 || ^19).
- Landing uses Next.js (SSR), web uses Vite (CSR). Shared components must work in both renderers.
- No Playwright installed yet. Need to set up e2e test infrastructure.
- Web app has no router — uses useState for view switching. May need react-router for deep linking.
- API has /auth/signup and /auth/login endpoints (email/password) but the web app doesn't use them — it relies on Supabase client-side auth + token passing.
