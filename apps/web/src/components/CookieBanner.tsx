import { useState } from "react";
import { api } from "../api.ts";

// ponytail: no analytics today — banner renders only if VITE_ANALYTICS is set.
// Hook present for when tracking lands. (Vite exposes env via import.meta.env,
// not process.env — NEXT_PUBLIC_* is Next.js-only and won't exist here.)
export function CookieBanner() {
  const [shown, setShown] = useState(true);
  if (!import.meta.env.VITE_ANALYTICS || !shown) return null;
  return (
    <div className="cookie-banner">
      <span>We use essential cookies; analytics only with your consent.</span>
      <button
        onClick={() => {
          api.setConsent(true);
          setShown(false);
        }}
      >
        Accept
      </button>
      <button
        onClick={() => {
          api.setConsent(false);
          setShown(false);
        }}
      >
        Reject
      </button>
    </div>
  );
}
