import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionDetail } from "../api.ts";
import { useEventStream } from "../useEventStream.ts";
import { useLiveRegion } from "../useLiveRegion.ts";
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
  const composerInputRef = useRef<HTMLInputElement>(null);
  const announce = useLiveRegion("polite");
  const announceAlert = useLiveRegion("assertive");

  useEffect(() => {
    api.getSession(id).then(setSession).catch(() => {});
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // Screen reader announcements for key streaming events
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
          announceAlert(`Error: ${String(p.message ?? "")}`);
          break;
        }
        case "state_change": {
          const state = String(p.state ?? "");
          if (state === "awaiting_user") {
            announceAlert(`Session is now awaiting your input`);
          } else if (TERMINAL_STATES.has(state)) {
            announceAlert(`Session ${state}`);
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
  }, [events, announce, announceAlert]);

  // Focus the composer when session enters awaiting_user
  const wasAwaiting = useRef(false);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.reply(id, body);
      setReply("");
      announce("Message sent");
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

  // Focus the composer when session enters awaiting_user
  useEffect(() => {
    if (awaitingUser && !wasAwaiting.current) {
      composerInputRef.current?.focus();
    }
    wasAwaiting.current = awaitingUser;
  }, [awaitingUser]);

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
  // Only auto-select on the first batch; once the user explicitly goes back
  // to the timeline (selectedFile = null via onBack), don't re-auto-select.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!selectedFile && fileMap.size > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
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

  const tabIds: Record<MobileTab, string> = {
    files: "tab-files",
    diff: "tab-diff",
    chat: "tab-chat",
  };
  const panelIds: Record<MobileTab, string> = {
    files: "panel-files",
    diff: "panel-diff",
    chat: "panel-chat",
  };

  return (
    <div className="ide-shell" role="application" aria-label="Session workspace">
      {/* ── Topbar ── */}
      <header className="ide-topbar" role="banner">
        <button
          className="ghost"
          onClick={onBack}
          aria-label="Back to sessions list"
        >
          ← back
        </button>
        <h1 className="ellipsis" aria-label={`Session: ${session?.task ?? id.slice(0, 8)}`}>
          {session?.task ?? id.slice(0, 8)}
        </h1>
        {!terminal && (
          <span
            className={`live-dot ${live ? "" : "off"}`}
            title={live ? "live" : "reconnecting"}
            role="status"
            aria-label={live ? "Stream live" : "Stream reconnecting"}
          />
        )}
        {!terminal && (
          <button
            className="ghost"
            title="finish: commit, push & shut down"
            onClick={() => api.finishSession(id).catch(() => {})}
            aria-label="Finish session: commit, push and shut down"
          >
            finish
          </button>
        )}
        {!terminal && (
          <button
            className="ghost"
            onClick={cancel}
            disabled={cancelling}
            title="cancel session"
            aria-label="Cancel session"
          >
            {cancelling ? "…" : "✕"}
          </button>
        )}
      </header>

      {/* ── State banner ── */}
      <div
        className={`ide-statebar tone-${stateTone(state)}`}
        role="status"
        aria-label={`Session state: ${state}${session ? `, ${repoLabel}` : ""}`}
      >
        <span>{state}</span>
        {session && <span className="muted small meta">{repoLabel}</span>}
      </div>

      {/* ── Mobile tabs ── */}
      <div className="ide-mobile-tabs" role="tablist" aria-label="Workspace panels">
        <button
          className={`ide-mobile-tab ${mobileTab === "files" ? "active" : ""}`}
          onClick={() => setMobileTab("files")}
          role="tab"
          id={tabIds.files}
          aria-selected={mobileTab === "files"}
          aria-controls={panelIds.files}
          tabIndex={mobileTab === "files" ? 0 : -1}
        >Files</button>
        <button
          className={`ide-mobile-tab ${mobileTab === "diff" ? "active" : ""}`}
          onClick={() => setMobileTab("diff")}
          role="tab"
          id={tabIds.diff}
          aria-selected={mobileTab === "diff"}
          aria-controls={panelIds.diff}
          tabIndex={mobileTab === "diff" ? 0 : -1}
        >Diff</button>
        <button
          className={`ide-mobile-tab ${mobileTab === "chat" ? "active" : ""}`}
          onClick={() => setMobileTab("chat")}
          role="tab"
          id={tabIds.chat}
          aria-selected={mobileTab === "chat"}
          aria-controls={panelIds.chat}
          tabIndex={mobileTab === "chat" ? 0 : -1}
        >Chat</button>
      </div>

      {/* ── Three-panel layout ── */}
      <div className="ide-panels">
        {/* ── Left: File tree ── */}
        <div
          className={`ide-panel ide-files ${mobileTab === "files" ? "active" : ""}`}
          role="region"
          aria-label="Files panel"
          id={panelIds.files}
          aria-labelledby={tabIds.files}
        >
          <FileTree
            files={fileMap}
            selected={selectedFile}
            onSelect={(p) => { setSelectedFile(p); setMobileTab("diff"); }}
          />
        </div>

        {/* ── Middle: Diff / Timeline ── */}
        <div
          className={`ide-panel ide-middle ${mobileTab === "diff" ? "active" : ""}`}
          role="region"
          aria-label="Timeline and diff panel"
          id={panelIds.diff}
          aria-labelledby={tabIds.diff}
        >
          {selectedEntry ? (
            <DiffPanel
              path={selectedEntry.path}
              content={selectedEntry.content}
              onBack={() => setSelectedFile(null)}
            />
          ) : (
            <>
              <div className="ide-panel-header" id="timeline-heading">
                Timeline
                <span className="ide-panel-count" aria-label={`${events.length} events`}>{events.length}</span>
              </div>
              <div
                className="ide-timeline"
                ref={chatScrollRef}
                role="log"
                aria-labelledby="timeline-heading"
                aria-live="polite"
                aria-relevant="additions"
              >
                {events.length === 0 && (
                  <p className="muted" role="status" style={{ padding: "0.5rem" }}>waiting for events…</p>
                )}
                {timelineItems.map(({ e, idx, label, dotClass, clickable, filePath }) => (
                  <div key={idx} className="ide-timeline-item ide-fade-in" role="listitem">
                    <div className="ide-timeline-marker" aria-hidden="true">
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
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        aria-label={
                          clickable
                            ? `View diff for ${filePath}`
                            : label
                        }
                        onKeyDown={(ev) => {
                          if (clickable && (ev.key === "Enter" || ev.key === " ")) {
                            ev.preventDefault();
                            if (filePath) {
                              setSelectedFile(filePath);
                              setMobileTab("diff");
                            }
                          }
                        }}
                      >
                        {label}
                      </span>
                      <span className="muted small" aria-label={`at ${new Date(e.ts).toLocaleTimeString()}`}>
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
        <div
          className={`ide-panel ide-chat ${mobileTab === "chat" ? "active" : ""}`}
          role="region"
          aria-label="Chat and activity panel"
          id={panelIds.chat}
          aria-labelledby={tabIds.chat}
        >
          {/* Progress bar when streaming */}
          {isStreaming && (
            <div
              className="ide-progress"
              role="progressbar"
              aria-label="Session activity in progress"
              aria-valuenow={undefined}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="ide-progress-bar" aria-hidden="true" />
            </div>
          )}

          {/* Chat messages */}
          <div
            className="ide-chat-messages"
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {events.length === 0 && <p className="muted" role="status">waiting for events…</p>}
            {events.map((e, idx) => (
              <div key={idx} className="ide-fade-in" role="listitem">
                {pendingQuestion?.seq === e.seq && e.type === "question" ? (
                  <div className="ide-approval" role="alert">
                    <EventCell event={e} onReply={(t) => send(t)} />
                  </div>
                ) : (
                  <EventCell event={e} onReply={(t) => send(t)} />
                )}
              </div>
            ))}
            {isStreaming && (
              <div
                className="ide-typing"
                role="status"
                aria-label="Assistant is typing"
              >
                <span className="ide-typing-dot" aria-hidden="true" />
                <span className="ide-typing-dot" aria-hidden="true" />
                <span className="ide-typing-dot" aria-hidden="true" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Inline steering bar when awaiting user */}
          {awaitingUser && !terminal && (
            <div className="ide-steer-bar" role="alert" aria-label="Awaiting your input">
              <span className="muted">⚠ Awaiting your input</span>
              <div className="ide-steer-actions" role="group" aria-label="Session actions">
                <button
                  className="ghost"
                  onClick={() => api.finishSession(id).catch(() => {})}
                  aria-label="Finish session"
                >finish</button>
                <button
                  className="ghost"
                  onClick={cancel}
                  disabled={cancelling}
                  aria-label="Cancel session"
                >
                  {cancelling ? "…" : "cancel"}
                </button>
              </div>
            </div>
          )}

          {/* PR status */}
          {prInfo && (
            <div
              className="ide-pr-status"
              role="status"
              aria-label={`Pull request: ${prInfo.sha}, ${prInfo.message}, ${prInfo.count} commit${prInfo.count > 1 ? "s" : ""}`}
            >
              <span className="badge ok" aria-hidden="true">PR</span>
              <span className="mono">{prInfo.sha}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{prInfo.message}</span>
              {prInfo.url && (
                <a
                  href={prInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View pull request ${prInfo.sha} on GitHub (opens in new tab)`}
                >view →</a>
              )}
              <span className="muted small" aria-label={`${prInfo.count} commits`}>
                {prInfo.count} commit{prInfo.count > 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Composer */}
          <form
            className={`ide-composer ${awaitingUser ? "awaiting" : ""}`}
            onSubmit={(e) => { e.preventDefault(); send(reply); }}
            role="search"
            aria-label="Send a message"
          >
            <input
              ref={composerInputRef}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={terminal ? "session ended" : awaitingUser ? "reply or steer…" : "reply…"}
              disabled={terminal}
              aria-label={terminal ? "Session ended" : awaitingUser ? "Reply or steer the session" : "Reply to the session"}
              aria-disabled={terminal}
            />
            <button
              type="submit"
              disabled={terminal || sending || !reply.trim()}
              aria-label="Send message"
            >send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
