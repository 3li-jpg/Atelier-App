import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "default" | "ok" | "warn" | "bad" | "accent" | "idle";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

const toneClasses: Record<BadgeTone, string> = {
  default: "atelier-badge-default",
  ok: "atelier-badge-ok",
  warn: "atelier-badge-warn",
  bad: "atelier-badge-bad",
  accent: "atelier-badge-accent",
  idle: "atelier-badge-idle",
};

export function Badge({ tone = "default", className, children, ...rest }: BadgeProps) {
  const classes = ["atelier-badge", toneClasses[tone], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
