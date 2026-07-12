"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5173";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export default function AuthCallback() {
  const [status, setStatus] = useState<"authenticating" | "redirecting" | "error">("authenticating");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase puts the session in the URL hash after OAuth redirect.
      // getSession() will pick it up and persist it to localStorage.
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        // No session — redirect to landing page
        setStatus("error");
        setErrorMsg("Authentication failed. Redirecting back…");
        setTimeout(() => {
          window.location.href = "/?auth_error=oauth_failed";
        }, 1500);
        return;
      }

      const token = data.session.access_token;
      setStatus("redirecting");
      // Brief delay so the overlay paints before the cross-origin navigation.
      // The web app's own loading state picks up from here.
      setTimeout(() => {
        window.location.href = `${DASHBOARD_URL}#token=${encodeURIComponent(token)}`;
      }, 350);
    };

    handleCallback();
  }, []);

  const message =
    status === "error" ? errorMsg :
    status === "redirecting" ? "Redirecting to dashboard…" :
    "Authenticating…";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-near-black, #090909)",
        overflow: "hidden",
      }}
    >
      {/* Violet radial bloom — matches Hero + TransitionOverlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 45%, rgba(175, 80, 255, 0.12), transparent 55%)",
          pointerEvents: "none",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            fontFamily: "var(--font-whyte, 'Inter', sans-serif)",
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: "-0.3px",
            color: "var(--color-almost-white, #f7f9fa)",
          }}
        >
          Atelier
        </div>

        {/* Spinner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-signal-violet, #af50ff)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              width: 28,
              height: 28,
              animation: "atelier-callback-spin 0.7s linear infinite",
            }}
          >
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
        <p
          style={{
            fontFamily: "var(--font-whyte-mono, 'JetBrains Mono', monospace)",
            fontSize: 12,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--color-steel, #828384)",
            margin: 0,
          }}
        >
          {message}
        </p>
      </motion.div>

      <style>{`
        @keyframes atelier-callback-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          svg { animation-duration: 1.5s !important; }
        }
      `}</style>
    </div>
  );
}
