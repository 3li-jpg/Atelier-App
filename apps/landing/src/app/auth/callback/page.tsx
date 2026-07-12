"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5173";

export default function AuthCallback() {
  useEffect(() => {
    const handleCallback = async () => {
      // Supabase puts the session in the URL hash after OAuth redirect.
      // getSession() will pick it up and persist it to localStorage.
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        // No session — redirect to landing page
        window.location.href = "/?auth_error=oauth_failed";
        return;
      }

      const token = data.session.access_token;
      // Redirect to dashboard with token in hash
      window.location.href = `${DASHBOARD_URL}#token=${encodeURIComponent(token)}`;
    };

    handleCallback();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#090909",
        color: "#f7f9fa",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            letterSpacing: "0.2em",
            color: "#828384",
            textTransform: "uppercase",
          }}
        >
          Authenticating
        </p>
        <p style={{ fontSize: 16, marginTop: 16, color: "#af50ff" }}>
          Redirecting to dashboard…
        </p>
      </div>
    </div>
  );
}
