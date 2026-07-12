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
// Fade + slight upward slide on enter; reverse on exit.
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION_NORMAL, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION_FAST, ease: EASE_IN_OUT },
  },
};

// ── Step transition (onboarding step changes) ─────────────────
// Slide horizontally based on direction (forward = +1, back = -1).
// The `custom` prop receives the direction.
export const stepTransition: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: DURATION_NORMAL, ease: EASE_OUT },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
    transition: { duration: DURATION_FAST, ease: EASE_IN_OUT },
  }),
};

// ── List item stagger ──────────────────────────────────────────
// Parent container drives the stagger; children fade + slide up.
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION_FAST, ease: EASE_OUT },
  },
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
// Replaces the CSS `.ide-fade-in` keyframe with a JS-driven version
// so we get consistent easing and can chain with stagger.
export const fadeIn: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION_FAST, ease: EASE_OUT },
  },
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
