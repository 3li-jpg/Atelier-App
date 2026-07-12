import { useCallback, useEffect, useRef } from "react";

// ── Screen-reader live region hook ──────────────────────────────
// Returns an announce() function that speaks text to assistive tech
// via a visually-hidden aria-live region. Two politeness levels:
//   - "polite" (default): waits for SR idle, good for streaming events
//   - "assertive": interrupts, good for errors / awaiting-user prompts
//
// The region is created once per mount and reused. Each call replaces
// the text content; a microtask delay ensures SRs re-announce even
// when the text is identical to the previous call.
export function useLiveRegion(politeness: "polite" | "assertive" = "polite") {
  const regionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("aria-live", politeness);
    el.setAttribute("aria-atomic", "true");
    el.setAttribute("role", "status");
    el.className = "sr-only";
    el.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
      "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
    document.body.appendChild(el);
    regionRef.current = el;
    return () => {
      el.remove();
      regionRef.current = null;
    };
  }, [politeness]);

  const announce = useCallback((message: string) => {
    const el = regionRef.current;
    if (!el) return;
    // Clear then set on next tick so SRs re-announce identical strings
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }, []);

  return announce;
}
