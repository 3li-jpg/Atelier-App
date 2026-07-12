# LOOP_STATE.md — Atelier Autonomous Improvement Loop

> Orchestrator memory across cycles. Read at start, rewrite at end of each cycle.

---

## DEFINITION OF DONE — Current Scores (0–5)

### UNIFICATION
| Item | C0 | C1 | Notes |
|------|----|----|-------|
| One coherent app: signup → dashboard → workspace share one origin/shell, one nav, one design. No jarring hand-off. | 1 | 2.5 | Web app now uses violet tokens matching landing. Still separate origins (landing :3001, web :5173). Onboarding flow within web app creates cohesion. |
| Session/workspace embedded in product shell, not bare proxied iframe. | 2 | 3.5 | SessionView is now a full IDE-lite three-panel layout embedded in the app shell. File tree, diff, timeline, chat, PR status all inline. |

### ONBOARDING
| Item | C0 | C1 | Notes |
|------|----|----|-------|
| New user reaches first running build in <60s: auth → BYOK → repo → task → workspace. No dead ends. | 1 | 3.5 | 4-step wizard with progress indicator. Auth (email/pass + GitHub OAuth), BYOK with presets + test key, repo picker, task description. Skip link for returning users. |
| First-run guidance: empty states, sample/template task, clear next action. | 1 | 3.0 | Example prompt chips in StepTask. Progress dots. Empty states in FileTree ("No files changed yet"). Still needs better empty states in SessionsList. |
| Model/provider setup friendly (presets for GLM/OpenRouter/Anthropic/custom). | 1 | 4.0 | 5 preset cards (OpenRouter, Anthropic, OpenAI, GLM, Custom) with auto-fill. Inline "Test key" button with latency + completion + tool-call validation. |

### LOOK & FEEL
| Item | C0 | C1 | Notes |
|------|----|----|-------|
| Violet "midnight terminal" applied consistently across landing + app + workspace. Amber theme gone. | 1 | 4.0 | Amber oklch tokens fully replaced with violet system. tokens.css is single source. Light theme removed. All existing class names preserved. |
| Shared component library used everywhere — no one-off styles. | 0 | 2.5 | packages/ui created with 8 components. Web app imports tokens. But existing components still use CSS classes, not the React components yet. Landing doesn't import packages/ui yet. |
| Motion: tasteful Framer-Motion transitions, hover/focus micro-interactions, page transitions. | 1 | 1.5 | SessionView has CSS fade-in animations and typing dots. But no Framer Motion in web app. Landing has Framer Motion. Reduced-motion media query added. |
| Typography + spacing scale from design tokens; strong visual hierarchy. | 1 | 3.0 | Tokens define type scale. Web app uses Inter + JetBrains Mono. Onboarding has clear hierarchy. Still some ad-hoc rem values in styles.css. |

### WORKSPACE UX
| Item | C0 | C1 | Notes |
|------|----|----|-------|
| IDE-lite: file tree/changed-files, DiffViewer, tool/terminal feed, run/PR status, inline approval + steering, streaming. | 2 | 4.0 | Three-panel layout. FileTree with A/M/D badges. DiffPanel with unified diff parser, line numbers, syntax colors, stats. Timeline with event markers. Inline approval bar. PR status. Streaming feel (typing dots, progress bar). Mobile tabs. |

### QUALITY
| Item | C0 | C1 | Notes |
|------|----|----|-------|
| Responsive: great on mobile PWA and desktop. | 2 | 3.5 | Three-panel collapses to mobile tabs. Onboarding is responsive. E2e tests verify 390px + 1440px. |
| Loading, empty, error, offline states everywhere. Keyboard nav + focus rings. | 1 | 2.0 | focus-visible added. FileTree/FilePanel empty states. Still missing: skeletons, offline state, keyboard nav for tabs. |
| Accessible contrast, aria labels, reduced-motion support. | 0 | 1.5 | reduced-motion media query added. Still missing: aria labels, focus management, screen reader support. |
| `npm run build` clean, typecheck clean, `npm test` green, e2e green, no console errors. | 2 | 4.0 | tsc clean, vite build clean, 48 unit tests pass, 6 e2e tests pass. Landing build pre-existing failure (React 18/19 hoisting). |
| Perf: fast first paint, no layout shift, lazy-load heavy views. | 1 | 1.5 | No code splitting yet. No lazy loading. Bundle is 400KB (112KB gzip). |

**Overall average: C0=1.2 → C1=2.9**

---

## PRIORITIZED BACKLOG (ordered by impact)

### HIGH IMPACT (cycle 2 targets)
1. **[LANE A] Add Framer Motion to web app** — page transitions, list stagger, hover micro-interactions, animated tabs, reduced-motion support. Install framer-motion in apps/web, create motion wrappers. (Files: apps/web/package.json, apps/web/src/App.tsx, apps/web/src/views/*.tsx, apps/web/src/onboarding/*.tsx)
2. **[LANE B] Refactor existing components to use @atelier/ui** — replace CSS class-based buttons/inputs with React components from packages/ui. Port SessionsList, NewTask, Providers, AuthBar to use Button/Input/Card/Badge. (Files: apps/web/src/views/SessionsList.tsx, NewTask.tsx, Providers.tsx, AuthBar.tsx, InstallPrompt.tsx)
3. **[LANE C] Accessibility + keyboard nav** — add aria-labels, role attributes, keyboard navigation for tabs/file tree, focus management, screen reader announcements for streaming events. (Files: apps/web/src/views/*.tsx, apps/web/src/components/*.tsx, apps/web/src/onboarding/*.tsx)

### MEDIUM IMPACT (cycle 3+)
4. Unify landing → app transition (same origin or invisible SSO handoff)
5. Add code splitting / lazy loading for SessionView and Onboarding
6. Add command palette (Cmd+K) for navigation
7. Add toast notification system for async feedback (wire up packages/ui/Toast)
8. Add skeleton loading states
9. Add offline state UI for PWA
10. Fix landing build (React 18/19 hoisting — use --install-strategy=nested)

### LOWER IMPACT
11. Add Lighthouse/perf audit and fix regressions
12. Add more Playwright e2e scenarios (mocked session, approval flow)
13. Add dark/light theme toggle (currently dark-only by design)

---

## CHANGELOG

### Cycle 1 — Research + Design System + Onboarding + Workspace
- Deep-researched competitive onboarding (Cursor, Replit, v0, Bolt, Lovable) and look&feel (Framer, Linear, Vercel, Cursor).
- Wrote DESIGN.md with concrete patterns, token spec, component spec, layout spec, motion guidelines.
- Audited repo against DoD: overall score 1.2/5.
- **LANE A**: Created packages/ui/ (8 React components + tokens.css + components.css). Replaced amber openchamber theme in styles.css with violet midnight-terminal tokens. Removed light theme. Added focus-visible + reduced-motion.
- **LANE B**: Built 4-step onboarding wizard (StepAuth, StepProvider, StepRepo, StepTask) with progress indicator, provider presets (OpenRouter/Anthropic/OpenAI/GLM/Custom), inline key validation, skip link. Added api.signup/login. Modified App.tsx for onboarding-first experience.
- **LANE C**: Rewrote SessionView as three-panel IDE-lite. Created FileTree (collapsible tree, A/M/D badges), DiffPanel (unified diff parser, line numbers, syntax colors, stats). Added timeline with event markers, inline approval bar, PR status, streaming feel (typing dots, progress bar), mobile tab switching.
- Set up Playwright e2e infrastructure (6 tests, all green).
- All gates passed: tsc clean, vite build clean, 48 unit tests pass, 6 e2e tests pass.
- Committed: `cycle-1: violet design system, guided onboarding, IDE-lite workspace`
- Overall score: 1.2 → 2.9

---

## CURRENT DESIGN DECISIONS
- **Unification approach**: Web app now uses the same violet token system as landing. Full origin unification (serving landing + app from one origin) deferred to cycle 3+.
- **Shared UI package**: packages/ui/ created with tokens + components. Web app imports tokens.css. Existing components still use CSS classes — cycle 2 will refactor to use React components.
- **Onboarding**: Multi-step wizard within web app. First-time users (no localStorage flag) see onboarding. Returning users see dashboard. Skip link available.
- **Workspace layout**: Three-panel (file tree | diff/timeline | chat+tools) with responsive collapse to mobile tabs.
- **Motion**: CSS-based animations for now. Cycle 2 will add Framer Motion.

---

## KNOWN ISSUES
- Landing uses React 19, web uses React 18. Shared UI package has peer dep on react ^18. Landing doesn't import packages/ui yet.
- Landing build fails due to React 18/19 hoisting conflict (pre-existing, needs --install-strategy=nested).
- No Framer Motion in web app yet — only CSS animations.
- Existing web components (SessionsList, NewTask, Providers, AuthBar) still use CSS classes, not @atelier/ui React components.
- No aria labels or keyboard navigation in web app.
- No code splitting — entire app in one 400KB bundle.
- Vite dev server proxy errors when API not running (expected in test env).
