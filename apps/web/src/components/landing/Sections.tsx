/**
 * Section primitives — small presentational components ported from
 * the landing's `.section__tag`, `.section__title`, `.section__sub`,
 * and `.doodle` classes.
 */
import type { ReactNode } from "react"

export function SectionTag({ children }: { children: ReactNode }) {
  return <p className="doodle section__tag">{children}</p>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section__title">{children}</h2>
}

export function SectionSub({ children }: { children: ReactNode }) {
  return <p className="section__sub">{children}</p>
}
