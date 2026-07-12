"use client";

import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5173";

export default function Hero() {
  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        background: "var(--color-near-black)",
        backgroundImage:
          "radial-gradient(circle at 80% 20%, rgba(175, 80, 255, 0.15), transparent 50%)",
        padding: "80px 0",
      }}
    >
      <div
        className="container hero-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "55% 45%",
          gap: "64px",
          alignItems: "center",
        }}
      >
        {/* ============ LEFT COLUMN ============ */}
        <div>
          {/* Line 1 — "Your code," */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0, ease: [0.16, 1, 0.3, 1] }}
            className="hero-display"
            style={{
              fontFamily: "var(--font-grandslang)",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "88px",
              lineHeight: 1.0,
              letterSpacing: "-2.64px",
              color: "var(--color-almost-white)",
              margin: 0,
            }}
          >
            Your code,
          </motion.h1>

          {/* Line 2 — "in any browser" */}
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="hero-heading"
            style={{
              fontFamily: "var(--font-whyte)",
              fontWeight: 400,
              fontSize: "64px",
              lineHeight: 1.1,
              letterSpacing: "-0.64px",
              color: "var(--color-almost-white)",
              margin: 0,
            }}
          >
            in any browser
          </motion.h2>

          {/* Line 3 — "with AI agents" */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="hero-display"
            style={{
              fontFamily: "var(--font-grandslang)",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "88px",
              lineHeight: 1.0,
              letterSpacing: "-2.64px",
              color: "var(--color-almost-white)",
              margin: 0,
            }}
          >
            with AI agents
          </motion.h1>

          {/* Subhead */}
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontFamily: "var(--font-whyte)",
              fontWeight: 300,
              fontSize: "20px",
              lineHeight: 1.5,
              letterSpacing: "-0.2px",
              color: "var(--color-steel)",
              maxWidth: "440px",
              marginTop: "32px",
            }}
          >
            Agentic coding from any browser. Bring your own model key. Agents run
            in isolated sandboxes, edit your repos, and ship PRs.
          </motion.p>
        </div>

        {/* ============ RIGHT COLUMN — BOARDING PASS CARD ============ */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{
            borderRadius: "19.2px",
            background: "rgba(237, 195, 196, 0.03)",
            border: "1px solid rgba(247, 249, 250, 0.2)",
            padding: "40px",
          }}
        >
          {/* Mono label */}
          <div
            style={{
              fontFamily: "var(--font-whyte-mono)",
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--color-steel)",
            }}
          >
            BOARDING PASS
          </div>

          {/* Route line */}
          <div
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "14px",
              color: "var(--color-almost-white)",
              marginTop: "20px",
              letterSpacing: "0.02em",
            }}
          >
            ORIGIN: GITHUB → DESTINATION: PRODUCTION
          </div>

          {/* Barcode */}
          <div
            style={{
              height: "60px",
              width: "100%",
              marginTop: "24px",
              marginBottom: "24px",
              background:
                "repeating-linear-gradient(90deg, #f7f9fa 0 2px, transparent 2px 4px, #f7f9fa 4px 7px, transparent 7px 8px, #f7f9fa 8px 11px, transparent 11px 13px, #f7f9fa 13px 17px, transparent 17px 19px, #f7f9fa 19px 21px, transparent 21px 24px, #f7f9fa 24px 27px, transparent 27px 29px, #f7f9fa 29px 32px, transparent 32px 34px, #f7f9fa 34px 38px, transparent 38px 40px)",
            }}
          />

          {/* Heading */}
          <h3
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "32px",
              fontWeight: 400,
              lineHeight: 1.2,
              letterSpacing: "-0.32px",
              color: "var(--color-almost-white)",
              marginBottom: "32px",
            }}
          >
            Deploys in seconds
          </h3>

          {/* Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <button
              onClick={signInWithGitHub}
              className="btn-pill btn-pill-violet"
              style={{ justifyContent: "center", cursor: "pointer" }}
            >
              Continue with GitHub
            </button>
            <a
              href="#join"
              className="btn-pill btn-pill-wash"
              style={{ justifyContent: "center" }}
            >
              Continue with Email
            </a>
          </div>
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
            gap: 48px !important;
          }

          .hero-display {
            font-size: 48px !important;
            letter-spacing: -1.2px !important;
          }

          .hero-heading {
            font-size: 36px !important;
            letter-spacing: -0.36px !important;
          }
        }
      `}</style>
    </section>
  );
}
