import { useEffect, useState } from "react";
import type { Event } from "@atelier/schema";
import type { FileEntry } from "../../components/FileTree.tsx";
import { latestTodos, collectSubagents } from "./ChatThread.tsx";

const LS_KEY = "atelier:ws-rail";

type RailTab = "files" | "browser" | "todos" | "activity";
type RailState = {
  railOpen: boolean;
  tab: RailTab;
};

const DEFAULTS: RailState = { railOpen: true, tab: "files" };

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
  sessionId,
}: {
  files: Map<string, FileEntry>;
  events: Event[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  mobileActive: boolean;
  sessionId: string;
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
  const tabs: { id: RailTab; label: string; count?: number }[] = [
    { id: "files", label: "Files", count: fileList.length },
    { id: "browser", label: "Browser" },
    { id: "todos", label: "Todos", count: todos.length },
    { id: "activity", label: "Activity" },
  ];

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
      {/* Tab bar — Files | Browser | Todos | Activity. The browser pane needs
          vertical room for the iframe, so the rail is now tabbed (one panel
          fills the body at a time) rather than stacked. */}
      <div className="ws-rail-tabs" role="tablist" aria-label="Side panel tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`ws-rail-tab ${s.tab === t.id ? "active" : ""}`}
            onClick={() => set({ tab: t.id })}
            role="tab"
            aria-selected={s.tab === t.id}
            aria-label={t.count !== undefined ? `${t.label}, ${t.count}` : t.label}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ws-rail-tab-count" aria-hidden="true">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="ws-rail-body">
        {s.tab === "files" && (
          <div className="ws-panel ws-panel-flat" data-collapsed={false}>
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
        )}

        {s.tab === "browser" && <BrowserPane sessionId={sessionId} />}

        {s.tab === "todos" && (
          <div className="ws-panel ws-panel-flat" data-collapsed={false}>
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
        )}

        {s.tab === "activity" && (
          <div className="ws-panel ws-panel-flat" data-collapsed={false}>
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
        )}
      </div>
    </aside>
  );
}

// Browser preview pane — renders the agent's working repo in an iframe via the
// /sessions/:id/preview/ static route. URL bar + refresh; the iframe reloads on
// demand so you can see the latest changes without leaving the workspace.
// ponytail: no history/back — refresh is enough for a preview loop.
function BrowserPane({ sessionId }: { sessionId: string }) {
  const [path, setPath] = useState("");
  const [nonce, setNonce] = useState(0);
  const src = `/sessions/${encodeURIComponent(sessionId)}/preview/${path.replace(/^\/+/, "")}?n=${nonce}`;
  return (
    <div className="ws-browser">
      <div className="ws-browser-bar">
        <button
          className="ws-browser-refresh"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh preview"
          title="Refresh preview"
        >
          ↻
        </button>
        <input
          className="ws-browser-url"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/"
          aria-label="Preview path"
          onKeyDown={(e) => { if (e.key === "Enter") setNonce((n) => n + 1); }}
        />
      </div>
      <iframe
        key={nonce}
        src={src}
        className="ws-browser-frame"
        title="Preview"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
