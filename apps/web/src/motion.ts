// Shared Framer Motion variants for the Atelier web app.
// Centralised so every surface uses consistent timing + easing that
// matches the midnight-terminal design system.

import type { Variants, Transition } from "framer-motion";

// ── Easing curves ──────────────────────────────────────────────
// A subtle ease-out that feels snappy on enter, gentle on exit.
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

// ── Durations ──────────────────────────────────────────────────
export const DURATION_FAST = 0.18;
export const DURATION_NORMAL = 0.3;
export const DURATION_SLOW = 0.45;

// ── Page transition (view switching in App.tsx) ────────────────
// IMPORTANT: JS-driven entrances must never gate visibility — if rAF stalls
// (throttled tabs, embedded webviews), content stuck at opacity 0 is a blank
// app. Entrance polish lives in CSS (.view-fade in styles.css), which always
// reaches its end state. These variants keep the API but render visible.
export const pageTransition: Variants = {
  initial: { opacity: 1, y: 0 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 1, y: 0 },
};

// ── Step transition (onboarding step changes) ─────────────────
// Same rule as pageTransition: never hide content behind a JS animation.
export const stepTransition: Variants = {
  enter: { x: 0, opacity: 1 },
  center: { x: 0, opacity: 1 },
  exit: { x: 0, opacity: 1 },
};

// ── List item stagger ──────────────────────────────────────────
// Neutered for the same reason; use CSS .view-fade on containers instead.
export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

export const staggerItem: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

// ── Hover micro-interactions ──────────────────────────────────
// Subtle lift + border-glow for interactive cards / rows.
export const hoverLift: Variants = {
  rest: { y: 0, scale: 1 },
  hover: {
    y: -2,
    scale: 1.005,
    transition: { duration: DURATION_FAST, ease: EASE_OUT },
  },
};

// Tap feedback for buttons / cards.
export const tapScale: Variants = {
  rest: { scale: 1 },
  hover: { scale: 1.02, transition: { duration: DURATION_FAST, ease: EASE_OUT } },
  pressed: { scale: 0.98, transition: { duration: 0.1, ease: EASE_IN_OUT } },
};

// ── Fade-in for streaming events ───────────────────────────────
// Neutered (see pageTransition note): streamed events must never be
// invisible because an entrance animation didn't run.
export const fadeIn: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

// ── Progress dot pulse (onboarding step indicator) ─────────────
export const dotPulse: Transition = {
  scale: [1, 1.3, 1],
  transition: { duration: 1.5, repeat: Infinity, ease: EASE_IN_OUT },
};

// ── Reduced-motion guard ──────────────────────────────────────
// Pass this to MotionConfig to disable animations for users who
// prefer reduced motion.
export const reducedMotion = "always" as const;
