import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
}

export function Skeleton({ width = "100%", height = "1em", radius, className }: SkeletonProps) {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: radius ?? "var(--radius-sm)",
  };
  const classes = ["atelier-skeleton", className ?? ""].filter(Boolean).join(" ");
  return <div className={classes} style={style} aria-hidden="true" />;
}
