// Inline diff viewer — renders file_diff events with a monospace diff view.
// Content may be a unified diff string, raw file content, or null (path only).
export function DiffViewer({ path, content }: { path: string; content: unknown }) {
  if (content == null) {
    return (
      <div className="cell diff" role="status" aria-label={`File: ${path}, no content`}>
        <span aria-hidden="true">📝 </span>
        <span className="mono">{path}</span>
      </div>
    );
  }
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <details className="cell diff" aria-label={`Diff for ${path}`}>
      <summary className="muted small">
        <span aria-hidden="true">📝 </span>
        <span>{path}</span>
      </summary>
      <pre className="tool-body" aria-label={`Diff content for ${path}`}>{text}</pre>
    </details>
  );
}
