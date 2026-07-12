import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionDetail } from "../api.ts";
import { useEventStream } from "../useEventStream.ts";
import { EventCell } from "../components/EventCell.tsx";
import { FileTree, type FileEntry } from "../components/FileTree.tsx";
import { DiffPanel } from "../components/DiffPanel.tsx";
import { stateTone, TERMINAL_STATES } from "../lib.ts";
import "./session-view.css";

type MobileTab = "files" | "diff" | "chat";

export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const { events, live } = useEventStream(id);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getSession(id).then(setSession).catch(() => {});
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.reply(id, body);
      setReply("");
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

  const cancel = async () => {
    if (cancelling || terminal) return;
    setCancelling(true);
    try { await api.cancelSession(id); }
    finally { setCancelling(false); }
  };

  // ── Build file map from file_diff events ──
  const fileMap = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const e of events) {
      if (e.type !== "file_diff") continue;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const files = (Array.isArray(p.files) ? p.files : []) as { path?: string; content?: unknown }[];
      if (files.length > 0) {
        for (const f of files) {
          const fp = f.path ?? "";
          if (fp) map.set(fp, { path: fp, content: f.content, seq: e.seq ?? 0 });
        }
      } else {
        const fp = String(p.path ?? p.file ?? "");
        if (fp) map.set(fp, { path: fp, content: p.content ?? null, seq: e.seq ?? 0 });
      }
    }
    return map;
  }, [events]);

  // ── Auto-select first file when files arrive ──
  useEffect(() => {
    if (!selectedFile && fileMap.size > 0) {
      setSelectedFile(fileMap.keys().next().value ?? null);
    }
  }, [fileMap, selectedFile]);

  const selectedEntry = selectedFile ? fileMap.get(selectedFile) ?? null : null;

  // ── Timeline items for the middle panel ──
  const timelineItems = useMemo(() => {
    return events.map((e, idx) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      let label: string = e.type;
      let dotClass = "";
      let clickable = false;
      let filePath: string | null = null;

      switch (e.type) {
        case "assistant_text":
          label = String(p.text ?? "").slice(0, 80);
          dotClass = "accent";
          break;
        case "tool_call":
          label = String(p.tool ?? p.name ?? "tool");
          dotClass = p.status === "running" ? "warn" : (typeof (p.exit_code ?? p.exitcode) === "number" && Number(p.exit_code ?? p.exitcode) === 0) ? "ok" : "bad";
          break;
        case "file_diff": {
          const files = (Array.isArray(p.files) ? p.files : []) as { path?: string }[];
          filePath = String(p.path ?? p.file ?? files[0]?.path ?? "");
          label = filePath || "diff";
          dotClass = "accent";
          clickable = !!filePath;
          break;
        }
        case "commit":
          label = `commit ${String(p.sha ?? "").slice(0, 7)}`;
          dotClass = "ok";
          break;
        case "question":
          label = String(p.prompt ?? p.message ?? "question");
          dotClass = "warn";
          break;
        case "state_change":
          label = String(p.state ?? "state");
          dotClass = stateTone(label);
          break;
        case "error":
          label = String(p.message ?? "error");
          dotClass = "bad";
          break;
        case "user_message":
          label = String(p.text ?? "user");
          dotClass = "";
          break;
        default:
          label = e.type;
      }
      return { e, idx, label, dotClass, clickable, filePath };
    });
  }, [events]);

  // ── PR status from commit events ──
  const prInfo = useMemo(() => {
    const commits = events.filter((e) => e.type === "commit");
    if (commits.length === 0) return null;
    const last = commits[commits.length - 1];
    const p = (last.payload ?? {}) as Record<string, unknown>;
    return {
      sha: String(p.sha ?? "").slice(0, 7),
      message: String(p.message ?? ""),
      url: typeof p.url === "string" ? p.url : null,
      count: commits.length,
    };
  }, [events]);

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

  const repoLabel = session
    ? `${session.repo_url.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "")} · ${session.branch} · ${session.model_id}`
    : "";

  return (
    <div className="ide-shell">
      {/* ── Topbar ── */}
      <header className="ide-topbar">
        <button className="ghost" onClick={onBack}>← back</button>
        <h1 className="ellipsis">{session?.task ?? id.slice(0, 8)}</h1>
        {!terminal && <span className={`live-dot ${live ? "" : "off"}`} title={live ? "live" : "reconnecting"} />}
        {!terminal && (
          <button className="ghost" title="finish: commit, push & shut down" onClick={() => api.finishSession(id).catch(() => {})}>
            finish
          </button>
        )}
        {!terminal && (
          <button className="ghost" onClick={cancel} disabled={cancelling} title="cancel session">
            {cancelling ? "…" : "✕"}
          </button>
        )}
      </header>

      {/* ── State banner ── */}
      <div className={`ide-statebar tone-${stateTone(state)}`}>
        <span>{state}</span>
        {session && <span className="muted small meta">{repoLabel}</span>}
      </div>

      {/* ── Mobile tabs ── */}
      <div className="ide-mobile-tabs">
        <button
          className={`ide-mobile-tab ${mobileTab === "files" ? "active" : ""}`}
          onClick={() => setMobileTab("files")}
        >Files</button>
        <button
          className={`ide-mobile-tab ${mobileTab === "diff" ? "active" : ""}`}
          onClick={() => setMobileTab("diff")}
        >Diff</button>
        <button
          className={`ide-mobile-tab ${mobileTab === "chat" ? "active" : ""}`}
          onClick={() => setMobileTab("chat")}
        >Chat</button>
      </div>

      {/* ── Three-panel layout ── */}
      <div className="ide-panels">
        {/* ── Left: File tree ── */}
        <div className={`ide-panel ide-files ${mobileTab === "files" ? "active" : ""}`}>
          <FileTree
            files={fileMap}
            selected={selectedFile}
            onSelect={(p) => { setSelectedFile(p); setMobileTab("diff"); }}
          />
        </div>

        {/* ── Middle: Diff / Timeline ── */}
        <div className={`ide-panel ide-middle ${mobileTab === "diff" ? "active" : ""}`}>
          {selectedEntry ? (
            <DiffPanel
              path={selectedEntry.path}
              content={selectedEntry.content}
              onBack={() => setSelectedFile(null)}
            />
          ) : (
            <>
              <div className="ide-panel-header">
                Timeline
                <span className="ide-panel-count">{events.length}</span>
              </div>
              <div className="ide-timeline" ref={chatScrollRef}>
                {events.length === 0 && (
                  <p className="muted" style={{ padding: "0.5rem" }}>waiting for events…</p>
                )}
                {timelineItems.map(({ e, idx, label, dotClass, clickable, filePath }) => (
                  <div key={idx} className="ide-timeline-item ide-fade-in">
                    <div className="ide-timeline-marker">
                      <span className={`ide-timeline-dot ${dotClass}`} />
                      <span className="ide-timeline-line" />
                    </div>
                    <div className="ide-timeline-content">
                      <span
                        className={`ide-timeline-text ${clickable ? "clickable" : ""}`}
                        onClick={() => {
                          if (filePath) {
                            setSelectedFile(filePath);
                            setMobileTab("diff");
                          }
                        }}
                      >
                        {label}
                      </span>
                      <span className="muted small">
                        {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Right: Chat + tools ── */}
        <div className={`ide-panel ide-chat ${mobileTab === "chat" ? "active" : ""}`}>
          {/* Progress bar when streaming */}
          {isStreaming && (
            <div className="ide-progress">
              <div className="ide-progress-bar" />
            </div>
          )}

          {/* Chat messages */}
          <div className="ide-chat-messages">
            {events.length === 0 && <p className="muted">waiting for events…</p>}
            {events.map((e, idx) => (
              <div key={idx} className="ide-fade-in">
                {pendingQuestion?.seq === e.seq && e.type === "question" ? (
                  <div className="ide-approval">
                    <EventCell event={e} onReply={(t) => send(t)} />
                  </div>
                ) : (
                  <EventCell event={e} onReply={(t) => send(t)} />
                )}
              </div>
            ))}
            {isStreaming && (
              <div className="ide-typing">
                <span className="ide-typing-dot" />
                <span className="ide-typing-dot" />
                <span className="ide-typing-dot" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Inline steering bar when awaiting user */}
          {awaitingUser && !terminal && (
            <div className="ide-steer-bar">
              <span className="muted">⚠ Awaiting your input</span>
              <div className="ide-steer-actions">
                <button className="ghost" onClick={() => api.finishSession(id).catch(() => {})}>finish</button>
                <button className="ghost" onClick={cancel} disabled={cancelling}>
                  {cancelling ? "…" : "cancel"}
                </button>
              </div>
            </div>
          )}

          {/* PR status */}
          {prInfo && (
            <div className="ide-pr-status">
              <span className="badge ok">PR</span>
              <span className="mono">{prInfo.sha}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{prInfo.message}</span>
              {prInfo.url && <a href={prInfo.url} target="_blank" rel="noopener noreferrer">view →</a>}
              <span className="muted small">{prInfo.count} commit{prInfo.count > 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Composer */}
          <form
            className={`ide-composer ${awaitingUser ? "awaiting" : ""}`}
            onSubmit={(e) => { e.preventDefault(); send(reply); }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={terminal ? "session ended" : awaitingUser ? "reply or steer…" : "reply…"}
              disabled={terminal}
            />
            <button type="submit" disabled={terminal || sending || !reply.trim()}>send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
