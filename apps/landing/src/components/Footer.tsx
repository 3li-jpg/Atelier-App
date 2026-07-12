"use client";

import { motion } from "framer-motion";

export default function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
      viewport={{ once: true }}
      style={{
        width: "100%",
        borderTop: "1px solid rgba(247,249,250,0.1)",
        padding: "40px 24px",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            color: "#f7f9fa",
          }}
        >
          <span>+</span>
          <span>Atelier</span>
          <span>—</span>
          <span style={{ color: "#8a8f98" }}>Agentic Coding</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            color: "#8a8f98",
          }}
        >
          <span>40.7128° N, 74.0060° W</span>
          <span style={{ color: "#f7f9fa" }}>♥</span>
        </div>
      </div>
    </motion.footer>
  );
}
