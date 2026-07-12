# Atelier — Design Reference

> "Midnight terminal with violet beacons."
> Target feel: Cursor / Framer / Linear / Vercel — calm, dark, high-contrast, generous spacing, micro-interactions, no visual noise.

---

## 1. Competitive Research — Concrete Patterns

### Onboarding Flows

**Cursor** (desktop, but web-equivalent patterns apply)
- Opens to a blank editor with a command palette (Cmd+K). First action is always "ask the AI to do something."
- No multi-step wizard. Instead: the product IS the onboarding. You start in the workspace immediately.
- Chat panel is front-and-center from second one. Empty state has a prompt input with placeholder examples.
- Key pattern: **zero-friction to first interaction**. No settings screens before you can type.

**Replit Agent**
- "Start building" → pick a template or describe what you want → agent starts immediately.
- Progress is visible: "Setting up environment...", "Installing dependencies...", "Writing code..."
- The workspace (file tree + editor + console) appears instantly, even before the agent finishes. You see it filling in.
- Key pattern: **live workspace from second 1**, progress streaming, never a loading spinner without context.

**Vercel v0**
- Single prompt input on the landing page. Type → it generates → you see preview + code immediately.
- No auth wall before first generation. You can try before you sign up.
- Key pattern: **try before auth**, then auth is frictionless (GitHub OAuth one-click).

**Bolt.new / Lovable**
- Chat interface → describes app → generates full-stack app in a WebContainer.
- File tree appears on the left, preview on the right, chat in the center/bottom.
- Key pattern: **three-panel IDE layout from the start** — file tree | preview/code | chat.

**Pattern synthesis for Atelier:**
1. Auth should be 1 click (GitHub OAuth) or email+password (2 fields). No multi-step wizard.
2. After auth, land directly in the workspace shell — not a dashboard with empty tabs.
3. BYOK (model key) setup should be inline, with presets and a "test key" button. Not a separate settings page.
4. Repo selection should be a searchable dropdown (GitHub repos) or paste-a-URL.
5. Task description should be a prominent input with example prompts.
6. Once submitted, the workspace should appear immediately with streaming progress.

### Look & Feel

**Framer** (framer.com)
- Dark surfaces: near-black (#080808) backgrounds, panels at rgba(255,255,255,0.03-0.05).
- Type: large, tight tracking, high contrast. Headings 48-88px, body 14-16px.
- Motion: everything animates on scroll/enter. ease [0.16, 1, 0.3, 1] (the "expo-out" curve). Subtle, 0.3-0.8s.
- Hover states: subtle background shifts (rgba +0.03), no scale transforms on cards.
- Focus: 2px ring in accent color, visible but not jarring.

**Linear**
- Ultra-clean. Dark theme: #08090a bg, #1c1e22 panels, #5e6ad2 accent (their indigo).
- Command palette (Cmd+K) everywhere. Keyboard-first.
- Spacing: 8px grid. Generous padding (16-24px on cards, 12-16px on inputs).
- Typography: Inter throughout. 13px UI text, 14px body, tight tracking on headings.
- Motion: minimal. Page transitions are instant. List items fade in 150ms.
- Key pattern: **density without clutter**. Every pixel earns its place.

**Vercel Dashboard**
- Clean white or dark. Cards with 1px borders, 8-12px radius.
- Status pills: small, uppercase, colored border + text (no fill).
- Tables/lists: hover row highlights, click to navigate.
- Key pattern: **status-first design**. Every item shows its state immediately.

**Cursor (editor)**
- Three-panel: file tree (left, 240px) | editor (center, flex) | chat/AI (right, 380px).
- Dark theme: #1e1e1e editor, #252526 sidebar, #007acc accent (blue, but structure matters).
- Inline diffs: green/red gutter, monospace, line-by-line.
- Key pattern: **IDE layout, not chat layout**. File tree + editor + activity panel.

### Pattern synthesis for Atelier workspace:
1. Three-panel layout: file tree / changed files (left) | diff viewer or timeline (center) | tool feed + chat (right).
2. Status pills: uppercase, small, colored border (violet for active, green for done, red for failed).
3. Command palette (Cmd+K) for actions (new session, switch session, settings).
4. Inline diffs with syntax highlighting (green/red lines, monospace).
5. Streaming text: assistant output appears token-by-token (or at least chunk-by-chunk).
6. Activity feed: collapsible tool calls with exit code badges, duration, expandable output.

---

## 2. Design Tokens (single source of truth)

### Colors
```
--color-near-black: #090909        /* page background */
--color-almost-white: #f7f9fa     /* primary text */
--color-soft-white: #f0f0f0       /* secondary text */
--color-steel: #828384            /* muted text, labels */
--color-graphite: #474747          /* borders, dividers */
--color-iron: #423738              /* dark surface variant */
--color-ash: #6b6b6b              /* tertiary text */
--color-signal-violet: #af50ff    /* accent / primary action */
--color-lavender-mist: #e1bdff    /* accent hover / glow */
```

### Semantic tokens (mapped from colors)
```
--bg: var(--color-near-black)
--panel: rgba(247, 249, 250, 0.03)
--panel-2: rgba(247, 249, 250, 0.06)
--border: rgba(247, 249, 250, 0.12)
--border-strong: rgba(247, 249, 250, 0.2)
--text: var(--color-almost-white)
--text-muted: var(--color-steel)
--accent: var(--color-signal-violet)
--accent-hover: #9a3ee6
--ok: #4ade80
--warn: #fbbf24
--bad: #f87171
```

### Typography
```
--font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif
--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace
--font-display: 'Playfair Display', ui-serif, Georgia, serif (italic only)

--text-xs: 11px    --leading-xs: 1.2    --tracking-xs: 0.05em
--text-sm: 13px    --leading-sm: 1.4
--text-base: 15px  --leading-base: 1.5
--text-lg: 18px    --leading-lg: 1.3    --tracking-lg: -0.2px
--text-xl: 24px    --leading-xl: 1.2    --tracking-xl: -0.3px
--text-2xl: 32px   --leading-2xl: 1.2   --tracking-2xl: -0.4px
--text-3xl: 48px   --leading-3xl: 1.1   --tracking-3xl: -0.5px
```

### Spacing (8px grid)
```
--space-1: 4px   --space-2: 8px   --space-3: 12px  --space-4: 16px
--space-5: 20px  --space-6: 24px  --space-8: 32px  --space-10: 40px
--space-12: 48px --space-16: 64px --space-20: 80px --space-24: 96px
```

### Radii
```
--radius-sm: 6px
--radius-md: 8px
--radius-lg: 12px
--radius-xl: 20px
--radius-full: 9999px
```

### Motion
```
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)
--duration-fast: 0.15s
--duration-normal: 0.3s
--duration-slow: 0.6s
```

---

## 3. Component Library Spec (packages/ui)

All components consume the tokens above. No hardcoded colors, sizes, or fonts.

- **Button**: variants (primary=violet, secondary=panel, ghost=transparent, danger=red). Sizes (sm, md, lg). Loading state with spinner.
- **Input**: text/password/email. Label, error, placeholder. Focus ring in violet.
- **Textarea**: auto-resize option. Same styling as Input.
- **Select**: styled dropdown. Same as Input.
- **Card**: panel background, border, radius-lg. Variants: default, elevated (stronger border), accent (violet tint).
- **Dialog/Modal**: backdrop blur, centered panel, escape to close, focus trap.
- **Tabs**: underline indicator, animated with layoutId (Framer Motion).
- **Toast**: top-right, auto-dismiss, variants (success/error/info).
- **Skeleton**: shimmer animation, violet-tinted.
- **Badge/Pill**: small, uppercase, colored border + text.
- **Spinner**: violet, sizes sm/md.

---

## 4. Layout Spec

### App Shell (unified)
```
┌─────────────────────────────────────────────────┐
│ Topbar: [Atelier logo]  [nav]  [user menu]       │  56px, sticky, blur bg
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Sidebar  │         Main content                  │
│ (collaps-│                                       │
│  ible)   │                                       │
│ 240px    │                                       │
│          │                                       │
├──────────┴──────────────────────────────────────┤
│ (optional: status bar / activity)                │
└─────────────────────────────────────────────────┘
```

### Workspace (SessionView)
```
┌─────────────────────────────────────────────────┐
│ Topbar: [← back] [task title] [state] [actions]  │
├──────────┬──────────────────────┬───────────────┤
│ Files    │   Diff / Timeline    │  Chat + Tools  │
│ (tree)   │   (tabbed)           │  (streaming)   │
│ 200px    │   flex               │   380px        │
├──────────┴──────────────────────┴───────────────┤
│ Composer: [input] [send]                         │
└─────────────────────────────────────────────────┘
```

### Onboarding Flow
```
Step 1: Welcome → "Continue with GitHub" or "Email"
Step 2: Connect model → presets (GLM/OpenRouter/Anthropic/Custom) + API key + "Test key"
Step 3: Pick repo → searchable dropdown (GitHub) or paste URL
Step 4: Describe task → textarea with example prompts
Step 5: → Land in workspace (session created, streaming begins)
```
Progress indicator: 4 dots/steps at top. Current step highlighted violet. Completed steps get a checkmark.

---

## 5. Motion Guidelines

- Page/route transitions: fade + slide-up 8px, 0.3s, --ease-out.
- List items: stagger fade-in, 50ms delay per item, 0.2s each.
- Hover on interactive elements: background transition 0.15s.
- Focus: ring appears 0.1s.
- Loading: skeleton shimmer 1.5s loop.
- Streaming text: no animation per token (too janky). Instead, new message blocks fade in 0.2s.
- Reduced motion: all transitions become 0s, no transforms.
