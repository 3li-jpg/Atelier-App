"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Full-screen transition overlay shown during the landing → app redirect.
 *
 * Renders a near-black surface with a violet radial bloom (matching the Hero
 * background), the Atelier wordmark, a violet spinner, and a status message.
 * The overlay fades in quickly, stays visible during window.location.href,
 * and is designed to visually match the loading state on the web app side
 * (apps/web/index.html) so the cross-origin navigation feels seamless.
 */
export default function TransitionOverlay({
  show,
  message = "Redirecting to dashboard…",
}: {
  show: boolean;
  message?: string;
}) {
  const [mounted, setMounted] = useState(false);

  // Delay the visible state by one frame so the enter animation plays.
  useEffect(() => {
    if (show) {
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    setMounted(false);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="atelier-transition-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: mounted ? 1 : 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          aria-live="assertive"
          role="status"
        >
          {/* Violet radial bloom — matches Hero background */}
          <div className="atelier-transition-bloom" />

          <motion.div
            className="atelier-transition-content"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 12 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          >
            {/* Wordmark */}
            <div className="atelier-transition-wordmark">Atelier</div>

            {/* Spinner */}
            <div className="atelier-transition-spinner">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeOpacity="0.2"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Status message */}
            <p className="atelier-transition-message">{message}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
