import { useEffect, useState } from "react";
import type { Event } from "@atelier/schema";
import { getAuthToken } from "./api.ts";

// T7.1: native EventSource against /sessions/:id/stream?cursor=N.
//
// Always connect from cursor=0: the chat thread renders FROM history, so a
// persisted resume cursor means a remount (reload, deep link, back/forward,
// StrictMode double-mount) shows an empty conversation resuming at the tail —
// a real shipped bug. Replay is cheap (one session's events) and in-memory
// seq-dedupe below makes it idempotent.
//
// NOTE: EventSource cannot send custom headers (Authorization), so we pass the
// auth token as a query parameter. The API middleware accepts ?token= as an
// alternative to the Bearer header specifically for SSE endpoints.
export function useEventStream(sessionId: string | null) {
  const [events, setEvents] = useState<Event[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!sessionId) { setEvents([]); setLive(false); return; }
    setEvents([]);
    const token = getAuthToken();
    const tokenQs = token ? `&token=${encodeURIComponent(token)}` : "";
    const es = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/stream?cursor=0${tokenQs}`);
    setLive(true);

    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as Event;
        setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [...prev, e]));
      } catch { /* ignore malformed frame */ }
    };
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);

    return () => { es.close(); setLive(false); };
  }, [sessionId]);

  return { events, live };
}
