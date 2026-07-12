import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionDetail } from "../api.ts";
import { useEventStream } from "../useEventStream.ts";
import { EventCell } from "../components/EventCell.tsx";
import { stateTone, TERMINAL_STATES } from "../lib.ts";

export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const { events, live } = useEventStream(id);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const cancel = async () => {
    if (cancelling || terminal) return;
    setCancelling(true);
    try { await api.cancelSession(id); }
    finally { setCancelling(false); }
  };

  return (
    <div className="page">
      <header className="topbar">
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
      <div className={`state-banner tone-${stateTone(state)}`}>
        <span>{state}</span>
        {session && (
          <span className="muted small meta">
            {session.repo_url.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "")} · {session.branch} · {session.model_id}
          </span>
        )}
      </div>
      <div className="timeline">
        {events.length === 0 && <p className="muted">waiting for events…</p>}
        {events.map((e) => (
          <EventCell key={e.seq} event={e} onReply={(t) => send(t)} />
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => { e.preventDefault(); send(reply); }}
      >
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={terminal ? "session ended" : "reply…"}
          disabled={terminal}
        />
        <button type="submit" disabled={terminal || sending || !reply.trim()}>send</button>
      </form>
    </div>
  );
}
