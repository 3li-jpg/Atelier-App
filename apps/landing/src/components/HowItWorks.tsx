export default function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Connect a repo",
      body: "Sign in with GitHub and pick any repository.",
    },
    {
      num: "02",
      title: "Chat with your agent",
      body: "Edits, tests, terminal — with subagents for big tasks.",
    },
    {
      num: "03",
      title: "Review the diff & ship",
      body: "Branch, commit, push, and open a pull request.",
    },
  ];

  return (
    <section id="how-it-works" className="section">
      <div className="container">
        <header className="section-header">
          <span className="section-eyebrow">How it works</span>
          <h2 className="section-title">From repo to PR in a chat</h2>
        </header>

        <div className="steps-grid">
          {steps.map((step, i) => (
            <div key={step.num} className={`glass-step reveal reveal-${i + 1}`}>
              <span className="step-num">{step.num}</span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-body">{step.body}</p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .steps-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }
        .glass-step {
          background: rgba(20, 20, 24, 0.6);
          backdrop-filter: blur(20px) saturate(1.4);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 28px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        .step-num {
          display: block;
          font-family: var(--font-whyte-mono, "JetBrains Mono", monospace);
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #af50ff;
          margin-bottom: 16px;
        }
        .step-title {
          font-family: var(--font-whyte, Inter, sans-serif);
          font-size: 19px;
          font-weight: 500;
          line-height: 1.3;
          color: var(--color-almost-white);
          margin: 0 0 8px;
        }
        .step-body {
          font-family: var(--font-whyte, Inter, sans-serif);
          font-size: 15px;
          font-weight: 400;
          line-height: var(--leading-body, 1.55);
          color: var(--color-soft-white);
          margin: 0;
        }
        @media (max-width: 768px) {
          .steps-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (prefers-contrast: more) {
          .glass-step {
            border-color: rgba(255, 255, 255, 0.25);
          }
        }
        @supports not (backdrop-filter: blur(1px)) {
          .glass-step {
            background: #141418;
          }
        }
      `}</style>
    </section>
  );
}
