"use client";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5173";

export default function Navbar() {
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(51, 50, 72, 0.7)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(247, 249, 250, 0.1)",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
        }}
      >
        {/* Left — Wordmark */}
        <a
          href="/"
          style={{
            fontFamily: "var(--font-whyte)",
            fontWeight: 500,
            fontSize: "18px",
            color: "var(--color-almost-white)",
            letterSpacing: "-0.2px",
            textDecoration: "none",
          }}
        >
          Atelier
        </a>

        {/* Center — Nav Links */}
        <div style={{ display: "flex", gap: "32px" }} className="nav-links-wrapper">
          <a href="#features" className="nav-link">
            Features
          </a>
          <a href="#pricing" className="nav-link">
            Pricing
          </a>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            Docs
          </a>
        </div>

        {/* Right — Action Buttons */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <a
            href={DASHBOARD_URL}
            className="btn-filled"
            style={{ padding: "10px 20px" }}
          >
            Log In
          </a>
          <a
            href="#join"
            className="btn-pill btn-pill-violet"
            style={{ padding: "10px 24px", fontSize: "14px" }}
          >
            Get Started
          </a>
        </div>
      </div>

      <style>{`
        .nav-link {
          color: var(--color-steel);
          font-family: var(--font-whyte);
          font-size: 14px;
          font-weight: 400;
          text-decoration: none;
          position: relative;
          transition: color 0.2s ease;
        }

        .nav-link::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: -4px;
          width: 0;
          height: 1px;
          background: var(--color-almost-white);
          transition: width 0.2s ease;
        }

        .nav-link:hover {
          color: var(--color-almost-white);
        }

        .nav-link:hover::after {
          width: 100%;
        }

        @media (max-width: 768px) {
          .nav-links-wrapper {
            display: none !important;
          }
        }
      `}</style>
    </nav>
  );
}
