export default function VioletBloom() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <div
          className="card card-violet-bloom reveal reveal-1"
          style={{
            padding: "var(--spacing-40)",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "32px",
              fontWeight: 400,
              color: "var(--color-almost-white)",
              marginBottom: "var(--spacing-16)",
              lineHeight: 1.2,
            }}
          >
            Start free
          </h2>
          <p
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "14px",
              fontWeight: 400,
              color: "var(--color-almost-white)",
              marginBottom: "var(--spacing-32)",
              maxWidth: "480px",
              lineHeight: "var(--leading-body-sm)",
            }}
          >
            No credit card required. Bring your model key and run your first
            agent in under a minute.
          </p>
          <a
            href="#join"
            className="btn-pill"
            style={{
              background: "var(--color-almost-white)",
              color: "var(--color-signal-violet)",
              border: "none",
            }}
          >
            Get started →
          </a>
        </div>
      </div>
    </section>
  );
}
