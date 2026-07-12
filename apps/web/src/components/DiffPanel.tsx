type DiffLineType = "add" | "del" | "context" | "hunk" | "header" | "plain";

type DiffLine = {
  type: DiffLineType;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

function isDiffContent(content: string): boolean {
  return content.includes("@@") || content.startsWith("---") || content.startsWith("diff --git");
}

function parseDiff(content: string): DiffLine[] {
  if (!isDiffContent(content)) {
    return content.split("\n").map((text) => ({
      type: "plain" as const,
      text,
      oldLine: null,
      newLine: null,
    }));
  }
  const lines = content.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "hunk", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      result.push({ type: "header", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith("-")) {
      result.push({ type: "del", text: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else {
      result.push({ type: "context", text: line, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return result;
}

function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === "add") additions++;
    if (line.type === "del") deletions++;
  }
  return { additions, deletions };
}

export function DiffPanel({ path, content, onBack }: {
  path: string;
  content: unknown;
  onBack?: () => void;
}) {
  if (content == null) {
    return (
      <section
        className="ide-diff-section"
        role="region"
        aria-label={`Diff for ${path}`}
      >
        <div className="ide-diff-header">
          {onBack && (
            <button
              className="ghost"
              onClick={onBack}
              aria-label="Back to timeline"
            >
              ←
            </button>
          )}
          <span className="ide-diff-path">{path}</span>
        </div>
        <div className="ide-diff-empty" role="status">No diff content available</div>
      </section>
    );
  }

  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  const lines = parseDiff(text);
  const stats = diffStats(lines);
  const isDiff = lines.some((l) => l.type === "add" || l.type === "del" || l.type === "hunk");

  return (
    <section
      className="ide-diff-section"
      role="region"
      aria-label={`Diff for ${path}${isDiff ? `, ${stats.additions} additions, ${stats.deletions} deletions` : ""}`}
    >
      <div className="ide-diff-header">
        {onBack && (
          <button
            className="ghost"
            onClick={onBack}
            aria-label="Back to timeline"
          >
            ←
          </button>
        )}
        <span className="ide-diff-path" aria-label={`File path: ${path}`}>{path}</span>
        {isDiff && (
          <span
            className="ide-diff-stats"
            aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}
          >
            <span className="add" aria-hidden="true">+{stats.additions}</span>
            <span className="del" aria-hidden="true">-{stats.deletions}</span>
          </span>
        )}
      </div>
      <div
        className="ide-diff-body"
        role="article"
        aria-label={`Diff content for ${path}`}
      >
        {lines.map((line, i) => {
          const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : "";
          const lineNo =
            line.type === "add" || line.type === "context"
              ? line.newLine
              : line.type === "del"
                ? line.oldLine
                : null;
          return (
            <div
              key={i}
              className={`ide-diff-line ${line.type}`}
              role="text"
              aria-label={`Line ${lineNo ?? ""}${sign ? ` ${sign}` : ""}: ${line.text}`}
            >
              <span className="ide-diff-lineno" aria-hidden="true">{lineNo ?? ""}</span>
              <span className="ide-diff-sign" aria-hidden="true">{sign}</span>
              <span className="ide-diff-content">{line.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
