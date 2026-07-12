// Collapsible tool activity feed — shows tool name, status badge, duration.
export function ToolFeed({ tool, status, exitCode, duration, summary }: {
  tool: string; status: string; exitCode?: number; duration?: number; summary?: unknown;
}) {
  const code = typeof exitCode === "number" ? exitCode : null;
  const label = status === "running" ? "•" : code === 0 ? "✓" : "✗";
  const cls = status === "running" ? "" : code === 0 ? "ok" : "bad";
  return (
    <div className="tool-call cell">
      <span className={`badge ${cls}`}>{label}</span>
      <span className="mono">{tool}</span>
      {duration != null && <span className="muted small">{duration}s</span>}
      {summary != null && (
        <details>
          <summary className="muted small">output</summary>
          <pre className="tool-body">
            {typeof summary === "string" ? summary : JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
