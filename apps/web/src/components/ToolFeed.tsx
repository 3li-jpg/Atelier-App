// Collapsible tool activity feed — shows tool name, status badge, duration.
export function ToolFeed({ tool, status, exitCode, duration, summary }: {
  tool: string; status: string; exitCode?: number; duration?: number; summary?: unknown;
}) {
  const code = typeof exitCode === "number" ? exitCode : null;
  const label = status === "running" ? "•" : code === 0 ? "✓" : "✗";
  const cls = status === "running" ? "" : code === 0 ? "ok" : "bad";

  const statusText = status === "running"
    ? "running"
    : code === 0
      ? "succeeded"
      : code !== null
        ? `failed with exit code ${code}`
        : status;

  const ariaLabel = `Tool: ${tool}, ${statusText}${duration != null ? `, ${duration} seconds` : ""}`;

  return (
    <div
      className="tool-call cell"
      role="listitem"
      aria-label={ariaLabel}
    >
      <span
        className={`badge ${cls}`}
        aria-hidden="true"
      >
        {label}
      </span>
      <span className="mono">{tool}</span>
      {duration != null && (
        <span className="muted small" aria-label={`Duration: ${duration} seconds`}>
          {duration}s
        </span>
      )}
      {summary != null && (
        <details>
          <summary className="muted small" aria-label={`Output for ${tool}`}>
            output
          </summary>
          <pre
            className="tool-body"
            aria-label={`Output content for ${tool}`}
          >
            {typeof summary === "string" ? summary : JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
