import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION_NORMAL, EASE_OUT } from "../motion.ts";

// Tracks browser online/offline status via navigator.onLine + the
// online/offline window events. Shows a fixed banner when offline so
// users understand why API calls and the event stream are failing.
// The banner slides down from the top with a fade, matching the app's
// existing Framer Motion animation language.
export function OfflineIndicator() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          className="offline-banner"
          role="alert"
          aria-live="assertive"
          aria-label="You are offline. Changes may not be saved."
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: DURATION_NORMAL, ease: EASE_OUT }}
        >
          <span className="offline-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4C7 4 2.7 6.1 0 9l2 2c2.5-2.5 6-4 10-4s7.5 1.5 10 4l2-2C21.3 6.1 17 4 12 4z"
                fill="currentColor"
                opacity="0.3"
              />
              <path
                d="M12 10c-2.5 0-4.8 1-6.5 2.5l2 2C9 13.2 10.4 12.5 12 12.5s3 .7 4.5 2l2-2C16.8 11 14.5 10 12 10z"
                fill="currentColor"
                opacity="0.6"
              />
              <circle cx="12" cy="18" r="2" fill="currentColor" />
              <line
                x1="4"
                y1="4"
                x2="20"
                y2="20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="offline-text">
            You're offline — changes may not sync until you reconnect.
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
