export default function Footer() {
  return (
    <footer
      className="reveal"
      style={{
        width: "100%",
        borderTop: "1px solid rgba(247,249,250,0.1)",
        padding: "32px 0",
      }}
    >
      <div className="container">
        <div className="footer-row">
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <a
              href="/"
              style={{
                fontFamily: "var(--font-whyte)",
                fontWeight: 500,
                fontSize: "17px",
                color: "var(--color-almost-white)",
                letterSpacing: "-0.2px",
                textDecoration: "none",
              }}
            >
              Atelier
            </a>
            <span
              style={{
                fontFamily: "var(--font-whyte)",
                fontSize: "13px",
                color: "var(--color-steel)",
              }}
            >
              Open-source, chat-first agentic coding. Bring your own key,
              bring your own compute.
            </span>
          </div>

          <div className="footer-right">
            <span
              style={{
                fontFamily: "var(--font-whyte)",
                fontSize: "13px",
                color: "var(--color-steel)",
              }}
            >
              Open source
            </span>
            <a
              href="https://github.com/3li-jpg/Atelier-App"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Atelier on GitHub"
              className="nav-link"
              style={{
                fontFamily: "var(--font-whyte)",
                fontSize: "13px",
                color: "var(--color-steel)",
                textDecoration: "none",
              }}
            >
              GitHub →
            </a>
            <span
              style={{
                fontFamily: "var(--font-whyte)",
                fontSize: "13px",
                color: "var(--color-steel)",
              }}
            >
              © 2026 Atelier
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
