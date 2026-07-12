# LOOP_STATE.md — Atelier Autonomous Improvement Loop

> Orchestrator memory across cycles. Read at start, rewrite at end of each cycle.

---

## DEFINITION OF DONE — Current Scores (0–5)

### UNIFICATION
| Item | C0 | C1 | C2 | Notes |
|------|----|----|----|----|
| One coherent app: signup → dashboard → workspace share one origin/shell, one nav, one design. | 1 | 2.5 | 3.0 | Violet tokens shared. Onboarding flow creates cohesion. Still separate origins (landing :3001, web :5173). |
| Session/workspace embedded in product shell, not bare proxied iframe. | 2 | 3.5 | 4.0 | Full IDE-lite three-panel layout. File tree, diff, timeline, chat, PR status all inline. |

### ONBOARDING
| Item | C0 | C1 | C2 | Notes |
|------|----|----|----|----|
| New user reaches first running build in <60s. | 1 | 3.5 | 4.0 | 4-step wizard with progress, presets, test key, skip. Framer Motion step transitions. |
| First-run guidance: empty states, templates, clear next action. | 1 | 3.0 | 3.5 | Example prompt chips. Skeleton loading states. Empty states with Card components. |
| Model/provider setup friendly (presets). | 1 | 4.0 | 4.0 | 5 preset cards. Inline test key validation. |

### LOOK & FEEL
| Item | C0 | C1 | C2 | Notes |
|------|----|----|----|----|
| Violet system applied consistently. Amber gone. | 1 | 4.0 | 4.0 | Complete. |
| Shared component library used everywhere. | 0 | 2.5 | 3.5 | SessionsList, NewTask, Providers, AuthBar, InstallPrompt now use @atelier/ui Button/Input/Card/Badge/Skeleton. |
| Motion: Framer-Motion transitions, hover/focus, page transitions. | 1 | 1.5 | 3.5 | Framer Motion added. Page transitions (AnimatePresence), nav tab micro-interactions, onboarding step slides. Reduced-motion via MotionConfig. |
| Typography + spacing from tokens; visual hierarchy. | 1 | 3.0 | 3.5 | Tokens are single source. @atelier/ui components enforce consistent styling. |

### WORKSPACE UX
| Item | C0 | C1 | C2 | Notes |
|------|----|----|----|----|
| IDE-lite: file tree, DiffViewer, tool feed, run/PR status, inline approval, streaming. | 2 | 4.0 | 4.5 | Three-panel layout with accessibility: keyboard nav for file tree, aria-live for streaming, role=tablist for mobile tabs. |

### QUALITY
| Item | C0 | C1 | C2 | Notes |
|------|----|----|----|----|
| Responsive: mobile PWA + desktop. | 2 | 3.5 | 3.5 | Three-panel collapses to mobile tabs. E2e verifies 390px + 1440px. |
| Loading, empty, error, offline states. Keyboard nav + focus rings. | 1 | 2.0 | 3.5 | Skeleton loading states. Focus-visible styles. Keyboard nav for file tree. aria-labels everywhere. Still missing: offline state. |
| Accessible contrast, aria labels, reduced-motion. | 0 | 1.5 | 3.5 | Comprehensive aria-labels. role=tree/treeitem with keyboard nav. aria-live regions. MotionConfig reducedMotion="user". useLiveRegion hook. |
| Build clean, typecheck clean, tests green, e2e green, no console errors. | 2 | 4.0 | 4.0 | All green. Landing build still pre-existing failure. Bundle 521KB (152KB gzip) — needs code splitting. |
| Perf: fast first paint, no layout shift, lazy-load. | 1 | 1.5 | 1.5 | No code splitting. Framer Motion added 120KB to bundle. Needs lazy loading. |

**Overall average: C0=1.2 → C1=2.9 → C2=3.5**

---

## PRIORITIZED BACKLOG (ordered by impact)

### HIGH IMPACT (cycle 3 targets)
1. **[LANE A] Code splitting + lazy loading** — React.lazy for SessionView and Onboarding. Manual chunks for framer-motion and @atelier/ui. Reduces initial bundle from 521KB to <200KB. (Files: apps/web/src/App.tsx, vite.config.ts)
2. **[LANE B] Unify landing → app transition** — Make the handoff seamless. Options: (a) serve landing as a route in the web app, (b) make the redirect invisible with shared design. At minimum: match the visual transition so it doesn't feel like a different app. (Files: apps/landing/src/components/SignupForm.tsx, apps/landing/src/components/Hero.tsx, apps/landing/src/app/auth/callback/page.tsx)
3. **[LANE C] Workspace polish + mocked e2e** — Add a Playwright test with a mocked SSE stream that renders a full session (assistant_text, tool_call, file_diff, question, commit events). Verify timeline, diff, file tree, approval all work end-to-end. Add skeleton states for SessionView loading. (Files: apps/web/e2e/session.spec.ts [new], apps/web/src/views/SessionView.tsx, apps/web/src/views/session-view.css)

### MEDIUM IMPACT (cycle 4+)
4. Add command palette (Cmd+K) for navigation
5. Add toast notification system (wire up @atelier/ui Toast)
6. Add offline state UI for PWA
7. Fix landing build (React 18/19 hoisting — use --install-strategy=nested)
8. Add more Playwright e2e scenarios
9. Add Lighthouse/perf audit

---

## CHANGELOG

### Cycle 2 — Framer Motion + Component Refactor + Accessibility
- **LANE A**: Installed framer-motion. Created motion.ts with shared variants (pageTransition, staggerContainer, tapScale). Added AnimatePresence page transitions to App.tsx. Added step slide transitions to Onboarding. Added nav tab micro-interactions. MotionConfig reducedMotion="user".
- **LANE B**: Refactored SessionsList (Skeleton, Card, Badge), NewTask (Input, Select, Textarea, Button), Providers (Card, Badge, Button), AuthBar (Button, Input), InstallPrompt (Button) to use @atelier/ui components.
- **LANE C**: Added aria-labels to workspace buttons. role=tree/treeitem with keyboard nav (arrows + enter) on FileTree. aria-live regions for streaming events. role=tablist on mobile tabs. focus-visible styles. useLiveRegion hook for screen reader announcements.
- All gates green: tsc, build (462 modules, 521KB), 48 unit tests, 6 e2e tests.
- Committed: `cycle-2: Framer Motion, @atelier/ui components, accessibility`
- Overall score: 2.9 → 3.5

### Cycle 1 — Research + Design System + Onboarding + Workspace
- Created packages/ui, killed amber theme, built onboarding, rewrote SessionView as IDE-lite.
- Overall score: 1.2 → 2.9

---

## CURRENT DESIGN DECISIONS
- **Motion**: Framer Motion with MotionConfig reducedMotion="user". Shared variants in motion.ts.
- **Components**: @atelier/ui is the single source for UI primitives. All views now use it.
- **Accessibility**: role=tree for file tree, aria-live for streaming, keyboard nav, focus-visible.
- **Unification**: Web app uses violet tokens. Landing still separate origin. Cycle 3 will address.

---

## KNOWN ISSUES
- Bundle is 521KB (152KB gzip) — needs code splitting (cycle 3 target)
- Landing build fails (React 18/19 hoisting, pre-existing)
- Landing doesn't import @atelier/ui yet
- No offline state UI
- No command palette
- No toast notifications wired up
- SessionView doesn't have skeleton loading state
- No mocked e2e test for full session flow
