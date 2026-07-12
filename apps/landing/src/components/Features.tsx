"use client";

import { motion } from "framer-motion";
import type { Variants } from "framer-motion";

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

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function Features() {
  return (
    <section id="features" className="section">
      <div className="container">
        <h2 className="section-stamp">F E A T U R E S</h2>

        <div>
          {features.map((feature, i) => (
            <div key={feature.label}>
              <motion.div
                className="feature-row"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "var(--spacing-40)",
                  padding: "var(--spacing-32) 0",
                }}
                variants={rowVariants}
                initial="hidden"
                whileInView="visible"
                custom={i}
                viewport={{ once: true, margin: "-50px" }}
              >
                <a
                  href="#"
                  style={{
                    fontFamily: "var(--font-whyte)",
                    fontSize: "14px",
                    color: "var(--color-signal-violet)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Learn More →
                </a>
                <p
                  style={{
                    fontFamily: "var(--font-whyte)",
                    fontSize: "18px",
                    fontWeight: 400,
                    lineHeight: "var(--leading-body)",
                    color: "var(--color-soft-white)",
                    textAlign: "right",
                  }}
                >
                  {feature.body}
                </p>
              </motion.div>
              <hr className="hairline" />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .feature-row {
            padding: var(--spacing-24) 0 !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: var(--spacing-12) !important;
          }
        }
      `}</style>
    </section>
  );
}
