"use client";

import { motion } from "framer-motion";
import type { Variants } from "framer-motion";

type Tier = {
  name: string;
  price: string;
  spec: string;
  description: string;
  cta: string;
  featured?: boolean;
};

const tiers: Tier[] = [
  {
    name: "Plus",
    price: "$6",
    spec: "20 hrs · 1 vCPU · 2 GB",
    description: "For tinkerers and solo builders.",
    cta: "Choose Plus",
  },
  {
    name: "Pro",
    price: "$10",
    spec: "40 hrs · 2 vCPU · 2 GB",
    description: "For daily drivers who ship.",
    cta: "Choose Pro",
    featured: true,
  },
  {
    name: "Max",
    price: "$25",
    spec: "140 hrs · 2 vCPU · 4 GB",
    description: "For teams that never stop.",
    cta: "Choose Max",
  },
];

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container">
        <h2 className="section-stamp">P R I C I N G</h2>

        <div className="pricing-grid">
          {tiers.map((tier, i) => (
            <motion.div
              key={tier.name}
              className="card card-translucent"
              style={{
                border: tier.featured
                  ? "1px solid var(--color-signal-violet)"
                  : "1px solid rgba(247,249,250,0.15)",
                padding: "var(--spacing-40)",
              }}
              variants={cardVariants}
              initial="hidden"
              whileInView="visible"
              custom={i}
              viewport={{ once: true, margin: "-50px" }}
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
                  fontSize: "16px",
                  lineHeight: "var(--leading-body)",
                  marginBottom: "var(--spacing-32)",
                }}
              >
                {tier.description}
              </p>

              {tier.featured ? (
                <a
                  href="#join"
                  className="btn-pill btn-pill-violet"
                  style={{ alignSelf: "flex-start" }}
                >
                  {tier.cta}
                </a>
              ) : (
                <a
                  href="#join"
                  className="btn-compact"
                  style={{ alignSelf: "flex-start" }}
                >
                  {tier.cta}
                </a>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      <style>{`
        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        @media (max-width: 768px) {
          .pricing-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
