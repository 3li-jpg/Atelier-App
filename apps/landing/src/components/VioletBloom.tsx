"use client";

import { motion } from "framer-motion";

export default function VioletBloom() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <motion.div
          className="card card-violet-bloom"
          style={{
            padding: "var(--spacing-40)",
            textAlign: "left",
          }}
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
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
        </motion.div>
      </div>
    </section>
  );
}
