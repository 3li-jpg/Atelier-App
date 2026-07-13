import { useEffect, useRef } from "react";

// Sticky glass composer. Auto-growing textarea; Enter=send, Shift+Enter=newline.
// Send = violet primary with a spring on press. No Stop button — cancel lives in
// the topbar overflow menu (api.cancelSession cancels the session, not a turn).
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
            aria-label={disabled ? "Session ended" : awaiting ? "Reply or steer the session" : "Message the session"}
            rows={1}
            aria-disabled={disabled}
          />
          <button
            type="submit"
            className="ws-send"
            disabled={disabled || sending || !value.trim()}
            aria-label="Send message"
          >
            {sending ? "…" : "Send"}
          </button>
        </form>
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
        </div>
      </div>
    </div>
  );
}
