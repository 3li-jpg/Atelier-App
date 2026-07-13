export default function Footer() {
  return (
    <footer
      className="reveal"
      style={{
        width: "100%",
        borderTop: "1px solid rgba(247,249,250,0.1)",
        padding: "40px 0",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "flex-start",
        }}
      >
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
        <p
          style={{
            fontFamily: "var(--font-whyte)",
            fontSize: "14px",
            color: "var(--color-steel)",
            margin: 0,
            maxWidth: "420px",
          }}
        >
          Agentic coding from any browser. Bring your own key.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginTop: "8px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "13px",
              color: "var(--color-steel)",
            }}
          >
            © 2026 Atelier
          </span>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
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
        </div>
      </div>
    </footer>
  );
}
