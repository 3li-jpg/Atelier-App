import { useEffect, useState } from "react";
import type { Event } from "@atelier/schema";
import type { FileEntry } from "../../components/FileTree.tsx";
import { latestTodos, collectSubagents } from "./ChatThread.tsx";

const LS_KEY = "atelier:ws-rail";

type RailState = {
  railOpen: boolean;
  filesOpen: boolean;
  todosOpen: boolean;
  activityOpen: boolean;
};

const DEFAULTS: RailState = {
  railOpen: true,
  filesOpen: true,
  todosOpen: true,
  activityOpen: true,
};

function loadRail(): RailState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RailState>) };
  } catch {
    return DEFAULTS;
  }
}

type FileStatus = "added" | "modified" | "deleted";
function inferStatus(content: unknown): FileStatus {
  if (typeof content !== "string") return "modified";
  if (content.includes("--- /dev/null")) return "added";
  if (content.includes("+++ /dev/null")) return "deleted";
  return "modified";
}
const STATUS_LETTER: Record<FileStatus, string> = { added: "A", modified: "M", deleted: "D" };

// Strip absolute sandbox path parentheticals from a subagent goal for DISPLAY
// only (the full goal stays in the title attr). Matches (/private/tmp/...),
// (/var/folders/...), (/tmp/...), etc. Never invents a summary when none exists.
function stripAbsPaths(goal: string): string {
  return goal.replace(/\s*\((?:\/(?:private\/tmp|var\/folders|tmp|Users|home|root)[^)]*)\)\s*/g, " ").trim();
}

// Subagent status → chip tone. running pulses violet, completed=green, failed=red.
function subagentTone(status: string): "running" | "ok" | "fail" {
  if (status === "running") return "running";
  if (status === "completed" || status === "ok" || status === "succeeded") return "ok";
  return "fail";
}

export function RightRail({
  files,
  events,
  selectedFile,
  onSelectFile,
  mobileActive,
}: {
  files: Map<string, FileEntry>;
  events: Event[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  mobileActive: boolean;
}) {
  const [s, setS] = useState<RailState>(loadRail);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  }, [s]);

  const set = (patch: Partial<RailState>) => setS((p) => ({ ...p, ...patch }));

  const todos = latestTodos(events);
  const subagents = collectSubagents(events);
  const toolCount = events.filter((e) => e.type === "tool_call").length;

  if (!s.railOpen && !mobileActive) {
    return (
      <button
        className="ws-rail-toggle"
        onClick={() => set({ railOpen: true })}
        aria-label="Show side panel"
      >
        ◀
      </button>
    );
  }

  const fileList = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <aside
      className={`ws-rail ${s.railOpen ? "" : "collapsed"} ${mobileActive ? "mobile-active" : ""}`}
      aria-label="Workspace side panel"
    >
      {!mobileActive && (
        <button
          className="ws-rail-toggle"
          onClick={() => set({ railOpen: false })}
          aria-label="Hide side panel"
        >
          ▶
        </button>
      )}
      <div className="ws-rail-body">
        {/* ── Files changed ── */}
        <div className="ws-panel" data-collapsed={!s.filesOpen}>
          <button
            className="ws-panel-head"
            onClick={() => set({ filesOpen: !s.filesOpen })}
            aria-expanded={s.filesOpen}
            aria-label={`Files changed, ${fileList.length} files`}
          >
            <span className="ws-panel-chevron" aria-hidden="true">▾</span>
            <span className="ws-panel-title">Files changed</span>
            <span className="ws-panel-count" aria-hidden="true">{fileList.length}</span>
          </button>
          <div className="ws-panel-content">
            {fileList.length === 0 ? (
              <div className="ws-empty-row" role="status">No files changed yet</div>
            ) : (
              fileList.map((f) => {
                const st = inferStatus(f.content);
                return (
                  <button
                    key={f.path}
                    className={`ws-file-item ${selectedFile === f.path ? "selected" : ""}`}
                    onClick={() => onSelectFile(f.path)}
                    aria-label={`${f.path}, ${st}`}
                    aria-current={selectedFile === f.path ? "true" : undefined}
                  >
                    <span className={`ws-file-status ${st}`} aria-hidden="true">{STATUS_LETTER[st]}</span>
                    <span className="ws-file-name">{f.path}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Todos ── */}
        <div className="ws-panel" data-collapsed={!s.todosOpen}>
          <button
            className="ws-panel-head"
            onClick={() => set({ todosOpen: !s.todosOpen })}
            aria-expanded={s.todosOpen}
            aria-label={`Todos, ${todos.length} items`}
          >
            <span className="ws-panel-chevron" aria-hidden="true">▾</span>
            <span className="ws-panel-title">Todos</span>
            <span className="ws-panel-count" aria-hidden="true">{todos.length}</span>
          </button>
          <div className="ws-panel-content">
            {todos.length === 0 ? (
              <div className="ws-empty-row" role="status">No todos yet</div>
            ) : (
              todos.map((t, i) => (
                <div key={i} className={`ws-todo-item ${t.done ? "done" : ""}`} role="listitem">
                  <span className="ws-todo-check" aria-hidden="true">{t.done ? "✓" : ""}</span>
                  <span className="ws-todo-text">{t.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Activity ── */}
        <div className="ws-panel" data-collapsed={!s.activityOpen}>
          <button
            className="ws-panel-head"
            onClick={() => set({ activityOpen: !s.activityOpen })}
            aria-expanded={s.activityOpen}
            aria-label="Activity"
          >
            <span className="ws-panel-chevron" aria-hidden="true">▾</span>
            <span className="ws-panel-title">Activity</span>
          </button>
          <div className="ws-panel-content">
            {subagents.length === 0 ? (
              <div className="ws-empty-row" role="status">No subagents active</div>
            ) : (
              subagents.map((sa, i) => {
                const goal = sa.goal || "";
                const display = goal ? stripAbsPaths(goal) : "Working…";
                return (
                  <div key={i} className="ws-subagent" role="listitem" aria-label={`Subagent: ${display}, ${sa.status}`}>
                    <div className="ws-subagent-goal" title={goal || undefined}>{display}</div>
                    <div className="ws-subagent-row">
                      <span className={`ws-subagent-status tone-${subagentTone(sa.status)}`}>
                        <span className={`ws-tool-dot ${subagentTone(sa.status)}`} aria-hidden="true" />
                        {sa.status}
                      </span>
                    </div>
                    {sa.summary && <div className="ws-subagent-summary">{sa.summary}</div>}
                  </div>
                );
              })
            )}
            <div className="ws-activity-tools" aria-label={`${toolCount} tool calls`}>
              {toolCount} tool call{toolCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
