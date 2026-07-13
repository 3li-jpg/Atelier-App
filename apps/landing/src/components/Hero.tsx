"use client";

import { supabase } from "@/lib/supabase";

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
        minHeight: "92vh",
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
          <h1
            className="hero-display reveal reveal-1"
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
          </h1>

          {/* Line 2 — "in any browser" */}
          <h2
            className="hero-heading reveal reveal-2"
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
          </h2>

          {/* Line 3 — "with AI agents" */}
          <h1
            className="hero-display reveal reveal-3"
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
          </h1>

          {/* Subhead */}
          <p
            className="reveal reveal-4"
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
          </p>
        </div>

        {/* ============ RIGHT COLUMN — BOARDING PASS CARD ============ */}
        <div
          className="reveal reveal-5 boarding-card"
          style={{
            borderRadius: "19.2px",
            background:
              "linear-gradient(180deg, rgba(175, 80, 255, 0.10), rgba(175, 80, 255, 0.04))",
            border: "1px solid rgba(175, 80, 255, 0.28)",
            boxShadow:
              "0 0 80px -20px rgba(175, 80, 255, 0.35), inset 0 1px 0 rgba(247, 249, 250, 0.08)",
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
              color: "var(--color-lavender-mist)",
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
              opacity: 0.55,
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
        </div>
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

        @media (max-width: 480px) {
          .hero-display {
            font-size: 40px !important;
            letter-spacing: -1px !important;
          }
          .hero-heading {
            font-size: 30px !important;
            letter-spacing: -0.3px !important;
          }
          .boarding-card {
            padding: 28px !important;
          }
        }
      `}</style>
    </section>
  );
}
