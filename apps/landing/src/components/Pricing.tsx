type Tier = {
  name: string;
  price: string;
  spec: string;
  description: string;
  cta: string;
  featured?: boolean;
  note?: string | null;
};

const tiers: Tier[] = [
  {
    name: "Free",
    price: "$0",
    spec: "BYOK + BYOC",
    description: "Your model key, your compute credits, all features.",
    cta: "Start free",
    note: null,
  },
  {
    name: "Plus",
    price: "$6",
    spec: "20 hrs · 1 vCPU · 2 GB",
    description: "For tinkerers and solo builders.",
    cta: "Choose Plus",
    note: "Hosted compute included",
  },
  {
    name: "Pro",
    price: "$10",
    spec: "40 hrs · 2 vCPU · 2 GB",
    description: "For daily drivers who ship.",
    cta: "Choose Pro",
    featured: true,
    note: "Hosted compute included",
  },
  {
    name: "Max",
    price: "$25",
    spec: "140 hrs · 2 vCPU · 4 GB",
    description: "For teams that never stop.",
    cta: "Choose Max",
    note: "Hosted compute included",
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container">
        <header className="section-header">
          <span className="section-eyebrow">Pricing</span>
          <h2 className="section-title">Pick a plan, bring your key</h2>
        </header>

        <div className="pricing-grid">
          {tiers.map((tier, i) => (
            <div
              key={tier.name}
              className={`pricing-card reveal reveal-${i + 1}${
                tier.featured ? " pricing-card--featured" : ""
              }`}
            >
              <h3
                style={{
                  fontFamily: "var(--font-whyte)",
                  fontSize: "20px",
                  fontWeight: 500,
                  color: "var(--color-almost-white)",
                  marginBottom: "var(--spacing-16)",
                }}
              >
                {tier.name}
              </h3>

              <p
                style={{
                  fontFamily: "var(--font-whyte)",
                  fontSize: "48px",
                  fontWeight: 300,
                  lineHeight: 1,
                  color: "var(--color-almost-white)",
                  marginBottom: "var(--spacing-12)",
                  margin: 0,
                }}
              >
                {tier.price}
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: 400,
                    color: "var(--color-steel)",
                  }}
                >
                  {" "}
                  /mo
                </span>
              </p>

              <p
                className="mono-label"
                style={{ marginBottom: "var(--spacing-24)" }}
              >
                {tier.spec}
              </p>

              <p
                className="text-steel"
                style={{
                  fontSize: "15px",
                  lineHeight: "var(--leading-body)",
                  marginBottom: "var(--spacing-32)",
                  margin: "0 0 var(--spacing-32) 0",
                }}
              >
                {tier.description}
              </p>

              {tier.note ? (
                <p
                  className="mono-label"
                  style={{
                    fontSize: "12px",
                    color: "var(--color-lavender-mist)",
                    marginTop: "var(--spacing-8)",
                    marginBottom: "var(--spacing-16)",
                  }}
                >
                  {tier.note}
                </p>
              ) : null}

              <a
                href="#join"
                className={`pricing-cta${
                  tier.featured ? " pricing-cta--filled" : " pricing-cta--outlined"
                }`}
                style={{ marginTop: "auto" }}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
