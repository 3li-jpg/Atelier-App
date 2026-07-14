/**
 * WinChrome — reusable window chrome shell.
 * Ported from the landing `Win` component: traffic-light dots,
 * a monospace title, an optional badge, and a body slot.
 * Pure presentational — no state, no deps beyond React.
 */
import type { ReactNode } from "react"

export function WinChrome({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: ReactNode
}) {
  return (
    <div className="win">
      <div className="win__chrome">
        <span className="win__dot win__dot--red" />
        <span className="win__dot win__dot--yellow" />
        <span className="win__dot win__dot--green" />
        <span className="win__title">{title}</span>
        {badge && <span className="win__badge">{badge}</span>}
      </div>
      <div className="win__body">{children}</div>
    </div>
  )
}
