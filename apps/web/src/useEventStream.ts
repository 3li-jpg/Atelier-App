import { useEffect, useState } from "react";
import type { Event } from "@atelier/schema";
import { cursorKey } from "./lib.ts";
import { getAuthToken } from "./api.ts";

// T7.1: native EventSource against /sessions/:id/stream?cursor=N. Cursor is
// persisted per-session in localStorage so a reload (or PWA re-open) resumes
// without replaying the whole history — matches the API's cursor-replay contract.
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
    const start = Number(localStorage.getItem(cursorKey(sessionId)) ?? 0);
    const token = getAuthToken();
    const tokenQs = token ? `&token=${encodeURIComponent(token)}` : "";
    const es = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/stream?cursor=${start}${tokenQs}`);
    setLive(true);

    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as Event;
        setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [...prev, e]));
        if (typeof e.seq === "number") localStorage.setItem(cursorKey(sessionId), String(e.seq));
      } catch { /* ignore malformed frame */ }
    };
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);

    return () => { es.close(); setLive(false); };
  }, [sessionId]);

  return { events, live };
}
