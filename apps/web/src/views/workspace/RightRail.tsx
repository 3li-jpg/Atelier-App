import { useEffect, useState } from "react";

// The right rail is now a single Browser preview pane. opencode's own web UI
// (embedded in the center column) already has its file tree, todos, and
// activity — Atelier no longer reimplements them. Files/todos/activity tabs
// depended on bridge events the shell no longer surfaces, so they're gone.
// ponytail: the rail stays collapsible; the iframe needs vertical room.

const LS_KEY = "atelier:ws-rail";

type RailState = { railOpen: boolean };
const DEFAULTS: RailState = { railOpen: true };

function loadRail(): RailState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RailState>) };
  } catch {
    return DEFAULTS;
  }
}

export function RightRail({
  mobileActive,
  sessionId,
}: {
  mobileActive: boolean;
  sessionId: string;
}) {
  const [s, setS] = useState<RailState>(loadRail);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  }, [s]);

  const set = (patch: Partial<RailState>) => setS((p) => ({ ...p, ...patch }));

  if (!s.railOpen && !mobileActive) {
    return (
      <button
        className="ws-rail-toggle"
        onClick={() => set({ railOpen: true })}
        aria-label="Show browser preview"
      >
        ◀
      </button>
    );
  }

  return (
    <aside
      className={`ws-rail ${s.railOpen ? "" : "collapsed"} ${mobileActive ? "mobile-active" : ""}`}
      aria-label="Browser preview"
    >
      {!mobileActive && (
        <button
          className="ws-rail-toggle"
          onClick={() => set({ railOpen: false })}
          aria-label="Hide browser preview"
        >
          ▶
        </button>
      )}
      <div className="ws-rail-body">
        <BrowserPane sessionId={sessionId} />
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
