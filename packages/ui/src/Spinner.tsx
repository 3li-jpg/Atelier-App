export type SpinnerSize = "sm" | "md";

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const sizeMap: Record<SpinnerSize, string> = {
  sm: "atelier-spinner-sm",
  md: "atelier-spinner-md",
};

export function Spinner({ size = "md", className }: SpinnerProps) {
  const classes = ["atelier-spinner", sizeMap[size], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} role="status" aria-label="Loading">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeOpacity="0.2"
        />
        <path
          d="M22 12a10 10 0 0 1-10 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
