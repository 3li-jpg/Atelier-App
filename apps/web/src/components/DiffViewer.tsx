// Inline diff viewer — renders file_diff events with a monospace diff view.
// Content may be a unified diff string, raw file content, or null (path only).
export function DiffViewer({ path, content }: { path: string; content: unknown }) {
  if (content == null) {
    return <div className="cell diff">📝 {path}</div>;
  }
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <details className="cell diff">
      <summary className="muted small">📝 {path}</summary>
      <pre className="tool-body">{text}</pre>
    </details>
  );
}
