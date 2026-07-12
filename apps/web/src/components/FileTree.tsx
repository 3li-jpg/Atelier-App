import { useEffect, useMemo, useState, type ReactNode } from "react";

export type FileEntry = {
  path: string;
  content: unknown;
  seq: number;
};

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  fileEntry?: FileEntry;
};

type FileStatus = "added" | "modified" | "deleted";

const STATUS_LABELS: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

function buildTree(files: Map<string, FileEntry>): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const [path, entry] of files) {
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: childPath,
          isDir: !isLast,
          children: [],
          fileEntry: isLast ? entry : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);
  return root;
}

function inferStatus(content: unknown): FileStatus {
  if (typeof content !== "string") return "modified";
  if (content.includes("--- /dev/null")) return "added";
  if (content.includes("+++ /dev/null")) return "deleted";
  return "modified";
}

export function FileTree({ files, selected, onSelect }: {
  files: Map<string, FileEntry>;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand all directories when new ones appear
  useEffect(() => {
    const dirs = new Set<string>();
    function collectDirs(node: TreeNode) {
      for (const child of node.children) {
        if (child.isDir) {
          dirs.add(child.path);
          collectDirs(child);
        }
      }
    }
    collectDirs(tree);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
  }, [tree]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  function renderNode(node: TreeNode, depth: number): ReactNode {
    if (node.isDir) {
      const isExpanded = expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            className="ide-tree-item dir"
            style={{ paddingLeft: `${depth * 0.8 + 0.6}rem` }}
            onClick={() => toggle(node.path)}
          >
            <span className="ide-tree-icon">{isExpanded ? "▾" : "▸"}</span>
            <span className="ide-tree-name">{node.name}</span>
          </button>
          {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const status = node.fileEntry ? inferStatus(node.fileEntry.content) : "modified";
    return (
      <button
        key={node.path}
        className={`ide-tree-item file ${selected === node.path ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 0.8 + 0.6}rem` }}
        onClick={() => onSelect(node.path)}
      >
        <span className="ide-tree-icon">○</span>
        <span className="ide-tree-name">{node.name}</span>
        <span className={`ide-file-status ${status}`}>{STATUS_LABELS[status]}</span>
      </button>
    );
  }

  if (files.size === 0) {
    return (
      <>
        <div className="ide-panel-header">
          Files
          <span className="ide-panel-count">0</span>
        </div>
        <div className="ide-tree-empty muted">No files changed yet</div>
      </>
    );
  }

  return (
    <>
      <div className="ide-panel-header">
        Files
        <span className="ide-panel-count">{files.size}</span>
      </div>
      <div className="ide-file-tree">
        {tree.children.map((child) => renderNode(child, 0))}
      </div>
    </>
  );
}
