export default function NotFound() {
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
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, letterSpacing: "0.2em", color: "#828384", textTransform: "uppercase" }}>
          404
        </p>
        <h1 style={{ fontSize: 48, fontWeight: 300, marginTop: 16 }}>
          Not found
        </h1>
        <a href="/" style={{ color: "#af50ff", fontSize: 14, marginTop: 24, display: "inline-block" }}>
          ← Back home
        </a>
      </div>
    </div>
  );
}
