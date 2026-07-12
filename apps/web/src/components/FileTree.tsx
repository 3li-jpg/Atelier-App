import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

const STATUS_FULL: Record<FileStatus, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
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

// Flatten visible tree nodes into a linear list for keyboard navigation.
function flattenVisible(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth = 0,
  acc: { node: TreeNode; depth: number }[] = [],
): { node: TreeNode; depth: number }[] {
  for (const node of nodes) {
    acc.push({ node, depth });
    if (node.isDir && expanded.has(node.path)) {
      flattenVisible(node.children, expanded, depth + 1, acc);
    }
  }
  return acc;
}

export function FileTree({ files, selected, onSelect }: {
  files: Map<string, FileEntry>;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const focusedKey = useRef<string | null>(null);

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

  // Keyboard navigation per WAI-ARIA tree pattern:
  // ArrowUp/Down: move focus between visible items
  // ArrowRight: expand dir or move to first child
  // ArrowLeft: collapse dir or move to parent
  // Enter/Space: activate (open file / toggle dir)
  // Home/End: first/last visible item
  const handleKeyDown = (e: React.KeyboardEvent, node: TreeNode) => {
    const flat = flattenVisible(tree.children, expanded);
    const currentIdx = flat.findIndex((f) => f.node.path === node.path);
    if (currentIdx === -1) return;

    let targetIdx: number | null = null;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        targetIdx = currentIdx < flat.length - 1 ? currentIdx + 1 : currentIdx;
        break;
      case "ArrowUp":
        e.preventDefault();
        targetIdx = currentIdx > 0 ? currentIdx - 1 : currentIdx;
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node.isDir && !expanded.has(node.path)) {
          toggle(node.path);
        } else if (node.isDir && node.children.length > 0) {
          targetIdx = currentIdx + 1;
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node.isDir && expanded.has(node.path)) {
          toggle(node.path);
        } else {
          // Find parent
          for (let i = currentIdx - 1; i >= 0; i--) {
            if (flat[i].depth < flat[currentIdx].depth) {
              targetIdx = i;
              break;
            }
          }
        }
        break;
      case "Home":
        e.preventDefault();
        targetIdx = 0;
        break;
      case "End":
        e.preventDefault();
        targetIdx = flat.length - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (node.isDir) {
          toggle(node.path);
        } else {
          onSelect(node.path);
        }
        return;
    }

    if (targetIdx !== null && targetIdx >= 0 && targetIdx < flat.length) {
      const target = flat[targetIdx].node;
      const el = itemRefs.current.get(target.path);
      if (el) {
        focusedKey.current = target.path;
        el.focus();
      }
    }
  };

  // Move focus when selected changes programmatically
  useEffect(() => {
    if (!selected) return;
    const el = itemRefs.current.get(selected);
    if (el) el.focus();
  }, [selected]);

  function renderNode(node: TreeNode, depth: number): ReactNode {
    const setRef = (el: HTMLButtonElement | null) => {
      if (el) itemRefs.current.set(node.path, el);
      else itemRefs.current.delete(node.path);
    };

    if (node.isDir) {
      const isExpanded = expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            ref={setRef}
            className="ide-tree-item dir"
            style={{ paddingLeft: `${depth * 0.8 + 0.6}rem` }}
            onClick={() => toggle(node.path)}
            onKeyDown={(e) => handleKeyDown(e, node)}
            role="treeitem"
            aria-expanded={isExpanded}
            aria-label={`${node.name}, folder${node.children.length > 0 ? `, ${node.children.length} item${node.children.length > 1 ? "s" : ""}` : ""}`}
            aria-level={depth + 1}
            tabIndex={node.path === focusedKey.current || (!focusedKey.current && depth === 0) ? 0 : -1}
          >
            <span className="ide-tree-icon" aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
            <span className="ide-tree-name">{node.name}</span>
          </button>
          {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const status = node.fileEntry ? inferStatus(node.fileEntry.content) : "modified";
    const isSelected = selected === node.path;
    return (
      <button
        key={node.path}
        ref={setRef}
        className={`ide-tree-item file ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 0.8 + 0.6}rem` }}
        onClick={() => onSelect(node.path)}
        onKeyDown={(e) => handleKeyDown(e, node)}
        role="treeitem"
        aria-selected={isSelected}
        aria-label={`${node.name}, file, ${STATUS_FULL[status]}`}
        aria-level={depth + 1}
        aria-current={isSelected ? "true" : undefined}
        tabIndex={node.path === focusedKey.current ? 0 : -1}
      >
        <span className="ide-tree-icon" aria-hidden="true">○</span>
        <span className="ide-tree-name">{node.name}</span>
        <span className={`ide-file-status ${status}`} aria-label={`Status: ${STATUS_FULL[status]}`}>{STATUS_LABELS[status]}</span>
      </button>
    );
  }

  if (files.size === 0) {
    return (
      <section aria-label="Files" aria-labelledby="files-heading">
        <div className="ide-panel-header" id="files-heading">
          Files
          <span className="ide-panel-count" aria-label="0 files">0</span>
        </div>
        <div className="ide-tree-empty muted" role="status">No files changed yet</div>
      </section>
    );
  }

  return (
    <section aria-label="Files panel" className="ide-files-section">
      <div className="ide-panel-header" id="files-heading">
        Files
        <span className="ide-panel-count" aria-label={`${files.size} files`}>{files.size}</span>
      </div>
      <div
        className="ide-file-tree"
        role="tree"
        aria-labelledby="files-heading"
        ref={treeContainerRef}
      >
        {tree.children.map((child) => renderNode(child, 0))}
      </div>
    </section>
  );
}
