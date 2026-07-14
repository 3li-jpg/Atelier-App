/**
 * Reveal — framer-motion whileInView fade + blur + rise wrapper.
 * Ported from Atelier-Landing. MotionConfig reducedMotion="user" is
 * expected at the app root; this just uses motion.div with the same
 * transition. Falls back gracefully if framer-motion is unavailable
 * at runtime (renders a plain div).
 */
import { motion } from "framer-motion"
import type { ReactNode } from "react"

const easeOut: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98]

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 44, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, delay: delay / 1000, ease: easeOut }}
    >
      {children}
    </motion.div>
  )
}
