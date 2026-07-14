import { useEffect, useMemo, useRef, useState } from "react";
import { api, getAuthToken, type SessionDetail } from "../api.ts";
import { useEventStream } from "../useEventStream.ts";
import { useLiveRegion } from "../useLiveRegion.ts";
import { stateTone, TERMINAL_STATES } from "../lib.ts";
import { humanizeToast } from "./humanize.ts";
import { useToast } from "@atelier/ui";
import { RightRail } from "./workspace/RightRail.tsx";
import "./session-view.css";
import "./workspace/workspace.css";

type MobileTab = "workspace" | "browser";

export function SessionView({ id, onBack, onOpenSession }: { id: string; onBack: () => void; onOpenSession?: (id: string) => void }) {
  const toast = useToast();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const { events, live } = useEventStream(id);
  const [cancelling, setCancelling] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("workspace");
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const announce = useLiveRegion("polite");
  const announceAlert = useLiveRegion("assertive");

  useEffect(() => {
    api.getSession(id).then(setSession).catch(() => {});
  }, [id]);

  // Screen reader announcements for key streaming events. The bridge still
  // emits state_change / error / commit even though the chat itself now lives
  // in the embedded opencode UI — these keep the shell reachable to AT users.
  const lastEventCount = useRef(0);
  useEffect(() => {
    if (events.length <= lastEventCount.current) return;
    const newEvents = events.slice(lastEventCount.current);
    lastEventCount.current = events.length;

    for (const e of newEvents) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      switch (e.type) {
        case "error": {
          const msg = String(p.message ?? "");
          announceAlert(`Error: ${msg}`);
          if (msg) toast.push(msg.slice(0, 120), "error");
          break;
        }
        case "state_change": {
          const state = String(p.state ?? "");
          if (state === "awaiting_user") {
            announceAlert(`Session is now awaiting your input`);
            toast.push("Session awaiting your input", "info");
          } else if (TERMINAL_STATES.has(state)) {
            announceAlert(`Session ${state}`);
            toast.push(`Session ${state}`, state === "completed" ? "success" : "error");
          } else {
            announce(`State: ${state}`);
          }
          break;
        }
        case "commit": {
          announce(`Commit: ${String(p.sha ?? "").slice(0, 7)} — ${String(p.message ?? "")}`);
          break;
        }
      }
    }
  }, [events, announce, announceAlert, toast]);

  // Derive live state from the stream (last state_change wins), fall back to the row.
  const state = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === "state_change");
    return String(last?.payload?.state ?? session?.state ?? "—");
  }, [events, session]);

  const terminal = TERMINAL_STATES.has(state);

  // ── Terminal: spin up a fresh workspace on this repo, reusing this
  // session's own provider/model/branch/toolsets. budgets/toolsets are JSON
  // strings on SessionDetail — parse defensively.
  const newSessionOnRepo = async () => {
    if (!session || creating) return;
    setCreating(true);
    try {
      let toolsets: string[] | undefined;
      try {
        // toolsets is its own JSON-string column on the session row
        // (verified against GET /sessions/:id — it is NOT inside budgets).
        const raw = session.toolsets ? JSON.parse(session.toolsets) : null;
        if (Array.isArray(raw)) toolsets = raw as string[];
      } catch { /* old rows have no toolsets */ }
      const res = await api.createSession({
        repo_url: session.repo_url ?? undefined,
        branch: session.branch,
        provider_id: session.provider_id,
        model_id: session.model_id,
        toolsets,
      });
      if (onOpenSession) onOpenSession(res.id);
      else toast.push("Workspace created", "success");
    } catch (e) {
      toast.push(humanizeToast(e), "error");
    } finally {
      setCreating(false);
    }
  };

  const cancel = async () => {
    if (cancelling || terminal) return;
    setCancelling(true);
    try {
      await api.cancelSession(id);
      toast.push("Session cancelled", "info");
    } catch (e) {
      toast.push(humanizeToast(e), "error");
    } finally {
      setCancelling(false);
      setMenuOpen(false);
    }
  };

  const finish = () => {
    setMenuOpen(false);
    api.finishSession(id).then(
      () => toast.push("Finishing session…", "info"),
      (e) => toast.push(humanizeToast(e), "error"),
    );
  };

  // Live autonomy toggle (landing: "flip on autopilot"). Persists + emits an
  // event; the runner applies the new permission policy on next handshake.
  const setMode = (mode: "auto" | "review" | "plan") => {
    if (!session || session.permission_mode === mode) return;
    setSession({ ...session, permission_mode: mode }); // optimistic
    api.updateSession(id, { permission_mode: mode }).catch((e) => {
      toast.push(humanizeToast(e), "error");
      api.getSession(id).then(setSession).catch(() => {}); // revert on failure
    });
  };

  const modelId = session?.model_id ?? "";

  // The opencode web UI is served by the session's opencode web process and
  // proxied at /sessions/:id/opencode/. Same-origin through the API proxy so
  // its SSE + fetch calls work without CORS. The token goes in the URL once so
  // the proxy can mint a session cookie for the iframe's subsequent calls
  // (iframes can't set Authorization headers). key on id so a session switch
  // remounts a fresh iframe (opencode holds session state in-memory).
  const ocSrc = `/sessions/${encodeURIComponent(id)}/opencode/${getAuthToken() ? `?token=${encodeURIComponent(getAuthToken())}` : ""}`;

  return (
    <div className="ws view-fade" role="application" aria-label="Session workspace">
      {/* ── Top bar: IDE chrome (dots + titlebar + active badge) ── */}
      <header className="ws-topbar" role="banner">
        <button className="ws-back" onClick={onBack} aria-label="Back to sessions list" title="Back">
          ←
        </button>
        <span className="ws-chrome-dots" aria-hidden="true">
          <span className="ws-dot red" />
          <span className="ws-dot yellow" />
          <span className="ws-dot green" />
        </span>
        <h1 className="ws-title ellipsis" title={session?.task ?? id} aria-label={`Session: ${session?.task ?? id.slice(0, 8)}`}>
          {session?.task ?? id.slice(0, 8)}
        </h1>
        {!terminal && (
          <span
            className={`ws-badge tone-${stateTone(state)}`}
            title={`${modelId || session?.model_id || "model"} · ${state}`}
          >
            {modelId || session?.model_id || "model"} · {state}
          </span>
        )}
        {!terminal && (
          <span
            className={`ws-live-dot ${live ? "" : "off"}`}
            title={live ? "live" : "reconnecting"}
            role="status"
            aria-label={live ? "Stream live" : "Stream reconnecting"}
          />
        )}
        {!terminal && session && (
          <div className="ws-mode-toggle" role="group" aria-label="Autonomy mode">
            {(["auto", "review", "plan"] as const).map((m) => (
              <button
                key={m}
                className={`ws-mode-btn ${session.permission_mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
                aria-pressed={session.permission_mode === m}
                title={
                  m === "auto" ? "Autopilot — agent runs without asking" :
                  m === "review" ? "Approve every change before the agent acts" :
                  "Plan only — agent proposes a plan, no edits"
                }
              >
                {m === "auto" ? "auto" : m === "review" ? "review" : "plan"}
              </button>
            ))}
          </div>
        )}
        {!terminal && (
          <div className="ws-overflow">
            <button
              className="ws-back"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Session actions menu"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div className="ws-overflow-menu" role="menu">
                  <button className="ws-overflow-item" onClick={finish} role="menuitem" aria-label="Finish session: commit, push and shut down">
                    finish session
                  </button>
                  <button
                    className="ws-overflow-item danger"
                    onClick={cancel}
                    disabled={cancelling}
                    role="menuitem"
                    aria-label="Cancel session"
                  >
                    {cancelling ? "cancelling…" : "cancel session"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Mobile segmented control ── */}
      <div className="ws-mobile-tabs" role="tablist" aria-label="Workspace panels">
        <div className="ws-mobile-seg">
          {(["workspace", "browser"] as const).map((t) => (
            <button
              key={t}
              className={`ws-mobile-tab ${mobileTab === t ? "active" : ""}`}
              onClick={() => setMobileTab(t)}
              role="tab"
              aria-selected={mobileTab === t}
              aria-label={t.charAt(0).toUpperCase() + t.slice(1)}
            >
              {t === "workspace" ? "Workspace" : "Browser"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: opencode web UI (embedded) + right rail (browser preview) ── */}
      <div className="ws-body">
        {/* opencode's own web UI — chat, diffs, todos, approval, file tree. The
            custom ChatThread/Composer/DiffPanel are no longer rendered (kept as
            dormant files for now). The iframe is same-origin via the proxy so
            opencode's SSE (/event) and fetch (/message, /session) all work. */}
        <div
          className={`ws-opencode ${mobileTab === "workspace" ? "mobile-active" : ""}`}
          role="region"
          aria-label="opencode workspace"
        >
          <iframe
            key={id}
            src={ocSrc}
            className="ws-opencode-frame"
            title="opencode workspace"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
          {terminal && (
            <div className="ws-opencode-ended" role="status" aria-label="Workspace ended">
              <span className="ws-endbar-text">This workspace has ended.</span>
              <button
                className="ws-endbar-cta"
                onClick={newSessionOnRepo}
                disabled={creating || !session}
                aria-label="New workspace on this repo"
              >
                {creating ? "starting…" : "New workspace on this repo"}
              </button>
            </div>
          )}
        </div>

        <RightRail
          mobileActive={mobileTab === "browser"}
          sessionId={id}
        />
      </div>
    </div>
  );
}
