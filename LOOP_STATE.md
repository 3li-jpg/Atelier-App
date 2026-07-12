# LOOP_STATE.md — Atelier Autonomous Improvement Loop

> Orchestrator memory across cycles. Read at start, rewrite at end of each cycle.

---

## DEFINITION OF DONE — Current Scores (0–5)

### UNIFICATION
| Item | C0 | C1 | C2 | C3 | Notes |
|------|----|----|----|----|-------|
| One coherent app: signup → dashboard → workspace share one origin/shell, one nav, one design. | 1 | 2.5 | 3.0 | 3.5 | Landing has TransitionOverlay + loading states. Boot screen in web app matches landing. Fonts preconnect. Still separate origins. |
| Session/workspace embedded in product shell, not bare proxied iframe. | 2 | 3.5 | 4.0 | 4.5 | Full IDE-lite with skeleton loading, enhanced empty states, 33 e2e tests verifying the full experience. |

### ONBOARDING
| Item | C0 | C1 | C2 | C3 | Notes |
|------|----|----|----|----|-------|
| New user reaches first running build in <60s. | 1 | 3.5 | 4.0 | 4.0 | 4-step wizard with progress, presets, test key, skip, Framer Motion transitions. |
| First-run guidance: empty states, templates, clear next action. | 1 | 3.0 | 3.5 | 4.0 | Skeleton loading, example prompts, enhanced empty states with pulsing dot. |
| Model/provider setup friendly (presets). | 1 | 4.0 | 4.0 | 4.0 | 5 preset cards. Inline test key validation. |

### LOOK & FEEL
| Item | C0 | C1 | C2 | C3 | Notes |
|------|----|----|----|----|-------|
| Violet system applied consistently. Amber gone. | 1 | 4.0 | 4.0 | 4.0 | Complete. |
| Shared component library used everywhere. | 0 | 2.5 | 3.5 | 3.5 | Views use @atelier/ui. Landing still uses inline styles. |
| Motion: Framer-Motion transitions, hover/focus, page transitions. | 1 | 1.5 | 3.5 | 4.0 | Framer Motion in web + landing. AnimatePresence, boot screen crossfade, transition overlay. |
| Typography + spacing from tokens; visual hierarchy. | 1 | 3.0 | 3.5 | 4.0 | Fonts loaded via preconnect. Tokens are single source. Boot screen matches design system. |

### WORKSPACE UX
| Item | C0 | C1 | C2 | C3 | Notes |
|------|----|----|----|----|-------|
| IDE-lite: file tree, DiffViewer, tool feed, run/PR status, inline approval, streaming. | 2 | 4.0 | 4.5 | 5.0 | 33 e2e tests verify full experience. Skeleton loading. Enhanced empty states. Fixed auto-select race condition. Comprehensive ARIA roles + keyboard nav. |

### QUALITY
| Item | C0 | C1 | C2 | C3 | Notes |
|------|----|----|----|----|-------|
| Responsive: mobile PWA + desktop. | 2 | 3.5 | 3.5 | 4.0 | Mobile tabs tested in e2e. Boot screen responsive. |
| Loading, empty, error, offline states. Keyboard nav + focus rings. | 1 | 2.0 | 3.5 | 4.0 | Skeleton loading. Enhanced empty states. Focus-visible. Keyboard nav for file tree. Error events with alert role. Still missing: offline state. |
| Accessible contrast, aria labels, reduced-motion. | 0 | 1.5 | 3.5 | 4.5 | Full ARIA: role=application, banner, tree, treeitem, log, tablist, search, alert. aria-labels on all interactive elements. MotionConfig reducedMotion="user". |
| Build clean, typecheck clean, tests green, e2e green, no console errors. | 2 | 4.0 | 4.0 | 4.5 | tsc, build, 48 unit tests, 33 e2e tests all green. No console errors verified by e2e. Landing build still pre-existing failure. |
| Perf: fast first paint, no layout shift, lazy-load. | 1 | 1.5 | 1.5 | 2.0 | Boot screen improves perceived load time. Fonts preconnect. Still no code splitting (530KB bundle). |

**Overall average: C0=1.2 → C1=2.9 → C2=3.5 → C3=3.9**

---

## PRIORITIZED BACKLOG (ordered by impact)

### HIGH IMPACT (cycle 4 targets)
1. **Code splitting** — React.lazy for SessionView and Onboarding. Manual chunks for framer-motion. Reduces 530KB bundle. (Files: App.tsx, vite.config.ts)
2. **Landing build fix** — Resolve React 18/19 hoisting (--install-strategy=nested). Currently blocks CI.
3. **Command palette (Cmd+K)** — Quick navigation between sessions, new task, providers.

### MEDIUM IMPACT (cycle 4+)
4. Toast notification system (wire up @atelier/ui Toast)
5. Offline state UI for PWA
6. Lighthouse/perf audit
7. Port landing components to @atelier/ui

---

## CHANGELOG

### Cycle 3 — Landing Transition + Boot Screen + Mocked E2E + Workspace Polish
- **LANE A**: Boot loading screen in index.html (violet radial bloom, spinner, mono text). Fonts preconnect. .boot-done crossfade in main.tsx.
- **LANE B**: TransitionOverlay component for landing. SignupForm loading state. Auth callback Framer Motion animation. Violet radial bloom matching design system.
- **LANE C**: 27 new Playwright e2e tests for SessionView (mocked SSE stream). Skeleton loading states. Enhanced empty states. Fixed auto-select race condition. Enhanced accessibility on all components.
- All gates green: tsc, build (464 modules), 48 unit tests, 33 e2e tests.
- Committed: `cycle-3: landing transition, boot screen, mocked e2e, workspace polish`
- Overall score: 3.5 → 3.9

### Cycle 2 — Framer Motion + Component Refactor + Accessibility
- Overall score: 2.9 → 3.5

### Cycle 1 — Research + Design System + Onboarding + Workspace
- Overall score: 1.2 → 2.9

---

## CURRENT DESIGN DECISIONS
- **Motion**: Framer Motion with MotionConfig reducedMotion="user". Shared variants in motion.ts.
- **Components**: @atelier/ui is the single source for UI primitives.
- **Accessibility**: Full ARIA roles, keyboard nav, screen reader support.
- **Boot screen**: index.html has a boot loading state that crossfades when React mounts.
- **Landing transition**: TransitionOverlay component provides seamless redirect.
- **E2E**: 33 tests covering app shell, onboarding, responsive, and full SessionView workspace.

---

## KNOWN ISSUES
- Bundle is 530KB (154KB gzip) — needs code splitting (cycle 4 target)
- Landing build fails (React 18/19 hoisting, pre-existing)
- Landing doesn't import @atelier/ui yet (uses inline styles)
- No offline state UI
- No command palette
- No toast notifications wired up
