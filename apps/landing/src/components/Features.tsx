"use client";

const features: { label: string; body: string }[] = [
  {
    label: "Bring your own key",
    body: "Connect any OpenAI-compatible endpoint. Your API key, your model, your bill. We never see it.",
  },
  {
    label: "Isolated sandboxes",
    body: "Every session runs in a fresh Firecracker microVM or Daytona sandbox. No shared state, no leaks.",
  },
  {
    label: "Live workspace",
    body: "Watch the agent edit files, run tests, and commit in real time. Approve or steer inline.",
  },
  {
    label: "Ship PRs",
    body: "Agents commit to a branch and push. Review the diff, merge, done.",
  },
];

export default function Features() {
  return (
    <section id="features" className="section">
      <div className="container">
        <header className="section-header">
          <span className="section-eyebrow">Features</span>
          <h2 className="section-title">Everything you need to ship</h2>
        </header>

        <div>
          {features.map((feature, i) => (
            <div key={feature.label}>
              <div
                className={`feature-row reveal reveal-${(i % 3) + 1}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: "var(--spacing-12)",
                  padding: "var(--spacing-32) 0",
                }}
              >
                <h3
                  style={{
                    fontFamily: "var(--font-grandslang)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: "32px",
                    lineHeight: 1.15,
                    letterSpacing: "-0.32px",
                    color: "var(--color-almost-white)",
                    margin: 0,
                  }}
                >
                  {feature.label}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-whyte)",
                    fontSize: "18px",
                    fontWeight: 400,
                    lineHeight: "var(--leading-body)",
                    color: "var(--color-soft-white)",
                    maxWidth: "640px",
                    margin: 0,
                  }}
                >
                  {feature.body}
                </p>
              </div>
              <hr className="hairline" />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .feature-row {
            padding: var(--spacing-24) 0 !important;
          }
          .feature-row h3 {
            font-size: 26px !important;
          }
        }
      `}</style>
    </section>
  );
}
