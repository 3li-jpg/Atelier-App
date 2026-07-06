// Pure helpers (no React, no DOM deps beyond Date/localStorage at call sites).
// Kept import-free so node --test can run lib.test.ts without a DOM or zod.
export type CellVariant =
  | "assistant" | "tool_call" | "question" | "user" | "state"
  | "error" | "diff" | "commit" | "test" | "verbose";

export function classifyEvent(type: string): CellVariant {
  switch (type) {
    case "assistant_text": return "assistant";
    case "tool_call": return "tool_call";
    case "question": return "question";
    case "user_message": return "user";
    case "state_change": return "state";
    case "error": return "error";
    case "file_diff": return "diff";
    case "commit": return "commit";
    case "test_run": return "test";
    default: return "verbose";
  }
}

export function cursorKey(sessionId: string): string {
  return `atelier:cursor:${sessionId}`;
}

// sqlite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, space-separated);
// event ts is a full ISO string. Normalize both to UTC before parsing.
export function formatRelTime(iso: string, now = Date.now()): string {
  const norm = iso.includes("T") ? iso : iso.replace(" ", "T");
  const withZ = norm.endsWith("Z") ? norm : `${norm}Z`;
  const t = new Date(withZ).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

export function stateTone(state: string): "ok" | "warn" | "bad" | "idle" {
  if (state === "completed") return "ok";
  if (state === "failed" || state === "cancelled") return "bad";
  if (state === "awaiting_user" || state === "hibernated") return "warn";
  return "idle";
}
