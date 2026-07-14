import { useEffect, useRef, type ReactNode } from "react";
import { useVoice } from "./useVoice.ts";

// Sticky glass composer. Auto-growing textarea; Enter=send, Shift+Enter=newline.
// Send = violet primary with a spring on press. No Stop button — cancel lives in
// the topbar overflow menu (api.cancelSession cancels the session, not a turn).
// `endBar` (when provided) replaces the input form — used for the terminal
// end-of-session affordance. `usage` renders a subtle mono token line.
export function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  awaiting,
  stateLabel,
  stateTone,
  modelId,
  repoBranch,
  placeholder,
  usage,
  endBar,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
  awaiting: boolean;
  stateLabel: string;
  stateTone: "ok" | "warn" | "bad" | "idle";
  modelId: string;
  repoBranch: string;
  placeholder: string;
  usage: { in: number; out: number } | null;
  endBar: ReactNode | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Voice dictation (Web Speech API). Appends transcript live; no-op on
  // browsers without SpeechRecognition (supported=false hides the mic).
  const voice = useVoice((t) => onChange(value ? `${value.replace(/\s+$/, "")} ${t}` : t));

  // Auto-grow: reset height then size to scrollHeight, capped.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Focus the composer when the session enters awaiting_user (preserves the
  // prior view's behavior — keeps keyboard users one keystroke from replying).
  const wasAwaiting = useRef(false);
  useEffect(() => {
    if (awaiting && !wasAwaiting.current) ref.current?.focus();
    wasAwaiting.current = awaiting;
  }, [awaiting]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !sending && value.trim()) onSend();
    }
  };

  return (
    <div className="ws-composer">
      <div className="ws-composer-inner">
        {endBar ?? (
          <form
            className={`ws-composer-form ${awaiting ? "awaiting" : ""}`}
            onSubmit={(e) => { e.preventDefault(); if (!disabled && !sending && value.trim()) onSend(); }}
            aria-label="Send a message"
          >
            <textarea
              ref={ref}
              className="ws-textarea"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              aria-label={disabled ? "Workspace ended" : awaiting ? "Reply or steer the workspace" : "Message the workspace"}
              rows={1}
              aria-disabled={disabled}
            />
            {voice.supported && (
              <button
                type="button"
                className={`ws-mic ${voice.listening ? "listening" : ""}`}
                onClick={voice.toggle}
                disabled={disabled}
                aria-label={voice.listening ? "Stop dictation" : "Dictate a task"}
                aria-pressed={voice.listening}
                title={voice.listening ? "Stop dictation" : "Dictate a task"}
              >
                {/* mic icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="currentColor" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              className="ws-send"
              disabled={disabled || sending || !value.trim()}
              aria-label="Send message"
            >
              {sending ? "…" : "Send"}
            </button>
          </form>
        )}
        <div className="ws-statusline" role="status" aria-label={`State ${stateLabel}, model ${modelId}, ${repoBranch}`}>
          <span className={`ws-state-chip tone-${stateTone}`}>{stateLabel}</span>
          {modelId && <>
            <span className="ws-dot-sep" aria-hidden="true">·</span>
            <span>{modelId}</span>
          </>}
          {repoBranch && <>
            <span className="ws-dot-sep" aria-hidden="true">·</span>
            <span className="ellipsis" style={{ minWidth: 0 }}>{repoBranch}</span>
          </>}
          {usage && (
            <span
              className="ws-usage"
              title={`${usage.in.toLocaleString()} in · ${usage.out.toLocaleString()} out`}
            >
              <span className="ws-dot-sep" aria-hidden="true">·</span>
              {fmtTokens(usage.in)} in · {fmtTokens(usage.out)} out
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ponytail: compact token counts (12.3k, 1.9k, 850). No chart, no panel.
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
