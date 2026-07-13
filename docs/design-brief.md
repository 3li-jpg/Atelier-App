# Atelier design brief — "liquid glass" system

Every UI change in this repo follows this brief. It adapts Apple's fluid-interface
principles (emilkowalski/skills apple-design) to Atelier's identity.

## Identity
- Near-black canvas (#090909), violet accent (--color-signal-violet ≈ #af50ff),
  soft-white text. Inter for UI, JetBrains Mono for code/metadata, serif italic
  (GrandSlang/Playfair) reserved for landing display headings only.
- The app should feel like Cursor/Linear: dense, calm, precise. No hero moments
  inside the product; craft lives in details (alignment, hover states, easing).

## Glass materials (hierarchy through translucency, not borders)
- Surfaces stack as translucent layers over the canvas:
  `background: rgba(20,20,24,0.6); backdrop-filter: blur(20px) saturate(1.4);`
  Use three weights: `--glass-thin` (nav bars, rgba .45/blur 12px),
  `--glass` (cards/panels, rgba .6/blur 20px), `--glass-thick` (modals/popovers,
  rgba .75/blur 32px). 1px inner border `rgba(255,255,255,0.08)`; radius 12–16px.
- Text over glass must stay legible: bump to soft-white, never pure gray-on-blur.
- Scroll edges: replace hard dividers with masked fade or a blur band
  (`mask-image: linear-gradient(...)`) where content scrolls under a bar.
- MANDATORY fallbacks: `@media (prefers-reduced-transparency: reduce)` and
  `@supports not (backdrop-filter: blur(1px))` → solid `#141418` surfaces.
  `@media (prefers-contrast: more)` → raise border alpha to 0.25.

## Motion
- Springs, not ease curves, for interactive movement. In CSS use
  `transition: transform 0.45s linear(...)` spring approximations sparingly, or
  `cubic-bezier(0.16, 1, 0.3, 1)` (our EASE_OUT) at 0.18–0.3s. Critically damped:
  no bounce unless a gesture supplied momentum.
- Interruptibility: never animate from a stale value. CSS transitions already
  retarget from the current value — prefer them. NEVER gate content visibility
  on a JS animation completing (hard rule from a real shipped bug: rAF stalls
  render the app invisible). Entrance polish = CSS keyframes with a guaranteed
  visible end state (`.view-fade` pattern), gated by
  `@media (prefers-reduced-motion: no-preference)`.
- Hover: subtle (translateY(-1px), border-alpha up). Press: scale(0.98) 100ms.
- `prefers-reduced-motion: reduce` → cross-fades only, no translation/scale.

## Typography
- Display/large (≥28px): letter-spacing −0.02em to −0.03em, leading 1.1–1.2.
- Body (13–16px): letter-spacing ~0, leading 1.5.
- Mono metadata (11–12px): uppercase, letter-spacing 0.08em, muted color.
- Numbers in metrics: `font-variant-numeric: tabular-nums`.

## Components
- Buttons: pill or 10px radius; violet filled = primary (one per view), glass
  ghost = secondary. Focus: 2px violet ring, offset 2px, `:focus-visible` only.
- Inputs: glass field, 1px border rgba(255,255,255,0.1), violet border+ring on
  focus. Labels 12px, muted, 6px above. 44px min touch targets on mobile.
- Status chips: tinted glass (green/amber/red/violet at 15% bg, 40% border).
- Empty states: icon + one sentence + one action. Never a wall of text.

## Eight checks before shipping a view
purpose · agency (user can always interrupt/undo) · familiarity (platform
conventions) · flexibility (keyboard + touch) · simplicity (one primary action)
· craft (aligned to a 4px grid) · delight (one subtle reward, e.g. a spring on
send) · accessibility (roles, labels, contrast ≥ 4.5:1, all three prefers-*).
