import type { ReactNode } from "react";

// Reusable state component for empty, error, and info states.
// Provides a consistent visual pattern: icon + title + description + optional action.
// Replaces the bare <p className="muted padded"> patterns scattered across views.
//
// Usage:
//   <StateMessage kind="empty" title="No sessions" description="Create one from the New tab" />
//   <StateMessage kind="error" title="Failed to load" description={err} action={<button onClick={retry}>Retry</button>} />
//   <StateMessage kind="info" title="Add a provider" description="..." action={<button>...</button>} />
export type StateMessageKind = "empty" | "error" | "info";

export function StateMessage({
  kind = "info",
  title,
  description,
  action,
}: {
  kind?: StateMessageKind;
  title: string;
  description?: string | ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`state-message state-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="state-message-icon" aria-hidden="true">
        {kind === "empty" && <EmptyIcon />}
        {kind === "error" && <ErrorIcon />}
        {kind === "info" && <InfoIcon />}
      </span>
      <div className="state-message-body">
        <p className="state-message-title">{title}</p>
        {description && <p className="state-message-desc muted small">{description}</p>}
        {action && <div className="state-message-action">{action}</div>}
      </div>
    </div>
  );
}

function EmptyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
      <rect
        x="10" y="8" width="28" height="22" rx="3"
        stroke="currentColor" strokeWidth="2" opacity="0.4"
      />
      <path
        d="M16 18h16M16 22h10"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3"
      />
      <circle cx="34" cy="34" r="6" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <line
        x1="38.5" y1="38.5" x2="42" y2="42"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      <path
        d="M24 14v12"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      />
      <circle cx="24" cy="32" r="1.8" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      <path
        d="M24 21v10"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      />
      <circle cx="24" cy="16" r="1.8" fill="currentColor" />
    </svg>
  );
}
