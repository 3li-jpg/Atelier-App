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
      <>
        <div className="ide-diff-header">
          {onBack && <button className="ghost" onClick={onBack}>←</button>}
          <span className="ide-diff-path">{path}</span>
        </div>
        <div className="ide-diff-empty">No diff content available</div>
      </>
    );
  }

  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  const lines = parseDiff(text);
  const stats = diffStats(lines);
  const isDiff = lines.some((l) => l.type === "add" || l.type === "del" || l.type === "hunk");

  return (
    <>
      <div className="ide-diff-header">
        {onBack && <button className="ghost" onClick={onBack}>←</button>}
        <span className="ide-diff-path">{path}</span>
        {isDiff && (
          <span className="ide-diff-stats">
            <span className="add">+{stats.additions}</span>
            <span className="del">-{stats.deletions}</span>
          </span>
        )}
      </div>
      <div className="ide-diff-body">
        {lines.map((line, i) => {
          const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : "";
          const lineNo =
            line.type === "add" || line.type === "context"
              ? line.newLine
              : line.type === "del"
                ? line.oldLine
                : null;
          return (
            <div key={i} className={`ide-diff-line ${line.type}`}>
              <span className="ide-diff-lineno">{lineNo ?? ""}</span>
              <span className="ide-diff-sign">{sign}</span>
              <span className="ide-diff-content">{line.text}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
