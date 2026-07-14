import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionDetail } from "../api.ts";
import { useEventStream } from "../useEventStream.ts";
import { useLiveRegion } from "../useLiveRegion.ts";
import { type FileEntry } from "../components/FileTree.tsx";
import { DiffPanel } from "../components/DiffPanel.tsx";
import { stateTone, TERMINAL_STATES } from "../lib.ts";
import { humanizeToast } from "./humanize.ts";
import { useToast } from "@atelier/ui";
import { ChatThread } from "./workspace/ChatThread.tsx";
import { Composer } from "./workspace/Composer.tsx";
import { RightRail } from "./workspace/RightRail.tsx";
import "./session-view.css";
import "./workspace/workspace.css";

type MobileTab = "chat" | "editor" | "files" | "activity";

export function SessionView({ id, onBack, onOpenSession }: { id: string; onBack: () => void; onOpenSession?: (id: string) => void }) {
  const toast = useToast();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const { events, live } = useEventStream(id);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Open-files tab model (Cursor-like): a file stays open as a tab until its ×
  // is clicked, independent of which file is active. Opening a file that's
  // already open just focuses its tab.
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const openFile = (p: string) => {
    setOpenFiles((prev) => (prev.includes(p) ? prev : [...prev, p]));
    setSelectedFile(p);
  };
  const closeFile = (p: string) => {
    const idx = openFiles.indexOf(p);
    const next = openFiles.filter((x) => x !== p);
    setOpenFiles(next);
    if (p === selectedFile) {
      // Focus the previous tab, else the one that shifted into its slot.
      setSelectedFile(idx > 0 ? (next[idx - 1] ?? null) : (next[idx] ?? null));
    }
  };
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const announce = useLiveRegion("polite");
  const announceAlert = useLiveRegion("assertive");

  useEffect(() => {
    api.getSession(id).then(setSession).catch(() => {});
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // Screen reader announcements for key streaming events (unchanged from prior).
  const lastEventCount = useRef(0);
  useEffect(() => {
    if (events.length <= lastEventCount.current) return;
    const newEvents = events.slice(lastEventCount.current);
    lastEventCount.current = events.length;

    for (const e of newEvents) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      switch (e.type) {
        case "assistant_text": {
          const text = String(p.text ?? "");
          if (text) announce(`Assistant: ${text.slice(0, 200)}`);
          break;
        }
        case "tool_call": {
          const tool = String(p.tool ?? p.name ?? "tool");
          const status = typeof p.status === "string" ? p.status : "done";
          announce(`Tool ${tool}: ${status}`);
          break;
        }
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
        case "question": {
          announceAlert(`Question: ${String(p.prompt ?? p.message ?? "")}`);
          break;
        }
        case "commit": {
          announce(`Commit: ${String(p.sha ?? "").slice(0, 7)} — ${String(p.message ?? "")}`);
          break;
        }
      }
    }
  }, [events, announce, announceAlert, toast]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.reply(id, body);
      setReply("");
      announce("Message sent");
    } catch (e) {
      toast.push(humanizeToast(e), "error");
    } finally {
      setSending(false);
    }
  };

  // Derive live state from the stream (last state_change wins), fall back to the row.
  const state = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === "state_change");
    return String(last?.payload?.state ?? session?.state ?? "—");
  }, [events, session]);

  const terminal = TERMINAL_STATES.has(state);
  const awaitingUser = state === "awaiting_user";

  // ── Cumulative token usage from `usage` events ({input, output, total}) ──
  // Each event is a turn's totals; sum for the session. `total` may be absent
  // on older runs — derive from input+output then.
  const usage = useMemo(() => {
    let i = 0, o = 0;
    for (const e of events) {
      if ((e.type as string) !== "usage") continue;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const ni = Number(p.input ?? p.in ?? 0);
      const no = Number(p.output ?? p.out ?? 0);
      const tot = Number(p.total ?? 0);
      if (ni || no) { i += ni || 0; o += no || 0; }
      else if (tot) o += tot; // total-only payloads: count once, not twice
    }
    return i || o ? { in: i, out: o } : null;
  }, [events]);

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
        repo_url: session.repo_url,
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

  // ── Build file map from file_diff events ──
  // Paths are humanized (repo-relative) and agent scratch files outside the
  // repo are dropped — old sessions recorded raw sandbox paths before the
  // runner filtered them.
  const cleanPath = (raw: string): string | null => {
    if (!raw) return null;
    const i = raw.indexOf("/repo/");
    if (i >= 0) return raw.slice(i + "/repo/".length) || null;
    return raw.startsWith("/") ? null : raw;
  };
  const fileMap = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const e of events) {
      if (e.type !== "file_diff") continue;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const files = (Array.isArray(p.files) ? p.files : []) as { path?: string; content?: unknown }[];
      if (files.length > 0) {
        for (const f of files) {
          const fp = cleanPath(String(f.path ?? ""));
          if (fp) map.set(fp, { path: fp, content: f.content, seq: e.seq ?? 0 });
        }
      } else {
        const fp = cleanPath(String(p.path ?? p.file ?? ""));
        if (fp) map.set(fp, { path: fp, content: p.content ?? null, seq: e.seq ?? 0 });
      }
    }
    return map;
  }, [events]);

  // Chat is the primary surface: diffs open only on explicit click. (An
  // auto-select-first-file effect used to live here — on mobile it replaced
  // the conversation with a diff panel the moment any file event arrived.)

  const selectedEntry = selectedFile ? fileMap.get(selectedFile) ?? null : null;

  // ── Streaming feel: detect if last event is recent ──
  const isStreaming = useMemo(() => {
    if (terminal || !live) return false;
    if (events.length === 0) return true;
    const last = events[events.length - 1];
    const ts = new Date(last.ts).getTime();
    return Date.now() - ts < 5000;
  }, [events, live, terminal]);

  // ── Pending question for inline approval ──
  const pendingQuestion = useMemo(() => {
    if (terminal) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "question") return e;
      if (e.type === "user_message") return null;
    }
    return null;
  }, [events, terminal]);

  const repoFullName = session?.repo_url
    ? session.repo_url.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "")
    : "";
  const repoBranch = session ? (repoFullName ? `${repoFullName} · ${session.branch}` : `blank workspace · ${session.branch}`) : "";
  const modelId = session?.model_id ?? "";
  const repoName = repoFullName.split("/").pop() || repoFullName;

  const placeholder = terminal
    ? "session ended"
    : awaitingUser
      ? "reply or steer…"
      : events.length === 0
        ? "What should we build?"
        : "reply…";

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
          {(["chat", "editor", "files", "activity"] as const).map((t) => (
            <button
              key={t}
              className={`ws-mobile-tab ${mobileTab === t ? "active" : ""}`}
              onClick={() => setMobileTab(t)}
              role="tab"
              aria-selected={mobileTab === t}
              aria-label={t.charAt(0).toUpperCase() + t.slice(1)}
            >
              {t === "chat" ? "Chat" : t === "editor" ? "Editor" : t === "files" ? "Files" : "Activity"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: center + right rail ── */}
      <div className="ws-body">
        <div
          className={`ws-center ${mobileTab === "chat" ? "mobile-active" : ""}`}
          role="region"
          aria-label="Conversation"
        >
          <ChatThread
            events={events}
            isStreaming={isStreaming}
            pendingQuestionSeq={pendingQuestion?.seq}
            repoName={repoName}
            onReply={(t) => send(t)}
            onOpenFile={(p) => { openFile(p); setMobileTab("editor"); }}
            selectedFile={selectedFile}
          />

          <Composer
            value={reply}
            onChange={setReply}
            onSend={() => send(reply)}
            sending={sending}
            disabled={terminal}
            awaiting={awaitingUser}
            stateLabel={state}
            stateTone={stateTone(state)}
            modelId={modelId}
            repoBranch={repoBranch}
            placeholder={placeholder}
            usage={usage}
            endBar={terminal ? (
              <div className="ws-endbar" role="status" aria-label="Workspace ended">
                <span className="ws-endbar-text">
                  This workspace has ended.
                </span>
                <button
                  className="ws-endbar-cta"
                  onClick={newSessionOnRepo}
                  disabled={creating || !session}
                  aria-label="New workspace on this repo"
                >
                  {creating ? "starting…" : "New workspace on this repo"}
                </button>
              </div>
            ) : null}
          />

        </div>

        {/* ── Editor column: persistent tabs + diff, coexists with chat
            (landing hero mockup grid: chat | editor). Empty → welcome
            placeholder, never destroys the conversation. ── */}
        <div
          className={`ws-editor ${mobileTab === "editor" ? "mobile-active" : ""}`}
          role="region"
          aria-label="Code editor"
        >
          {openFiles.length === 0 ? (
            <div className="ws-editor-empty">
              <span className="ws-editor-empty-glyph" aria-hidden="true">⌘</span>
              <p className="ws-editor-empty-title">No file open</p>
              <p className="ws-editor-empty-hint">Click a file in Files, or a change in chat, to open it here.</p>
            </div>
          ) : (
            <>
              <div className="ws-editor-tabs" role="tablist" aria-label="Open files">
                {openFiles.map((p) => (
                  <button
                    key={p}
                    className={`ws-editor-tab ${p === selectedFile ? "active" : ""}`}
                    onClick={() => setSelectedFile(p)}
                    role="tab"
                    aria-selected={p === selectedFile}
                    title={p}
                  >
                    <span className="ws-editor-tab-name">{p.split("/").pop()}</span>
                    <span
                      className="ws-editor-tab-close"
                      role="button"
                      tabIndex={-1}
                      aria-label={`Close ${p}`}
                      onClick={(e) => { e.stopPropagation(); closeFile(p); }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
              <div className="ws-editor-stage">
                {selectedEntry ? (
                  <DiffPanel path={selectedEntry.path} content={selectedEntry.content} />
                ) : (
                  <div className="ws-editor-empty"><p className="ws-editor-empty-hint">File not available.</p></div>
                )}
              </div>
            </>
          )}
        </div>

        <RightRail
          files={fileMap}
          events={events}
          selectedFile={selectedFile}
          onSelectFile={(p) => { openFile(p); setMobileTab("editor"); }}
          mobileActive={mobileTab === "files" || mobileTab === "activity"}
        />
      </div>

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
