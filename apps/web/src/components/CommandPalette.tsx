import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_OUT, DURATION_FAST, DURATION_NORMAL } from "../motion.ts";

// ── Types ────────────────────────────────────────────────────────
export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string;
  icon?: ReactNode;
  perform: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands?: Command[];
}

// ── Fuzzy match ──────────────────────────────────────────────────
// Lightweight subsequence fuzzy match with contiguous-word bonus.
// Returns a score (higher = better) or -1 if no match.
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring match — highest priority
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 + q.length; // prefix match
  if (idx > 0) return 500 - idx;          // substring match

  // Subsequence fuzzy match
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += streak * 2; // bonus for consecutive chars
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1; // didn't match all query chars
  return score;
}

// ── Navigation helpers ───────────────────────────────────────────
// App.tsx owns view state via useState and renders <nav> buttons with
// labels matching TABS. Since we can't modify App.tsx, we navigate by
// clicking the corresponding nav button in the DOM.
function clickNavButton(label: string): boolean {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".nav button");
  for (const btn of buttons) {
    if (btn.textContent?.trim().toLowerCase() === label.toLowerCase()) {
      btn.click();
      return true;
    }
  }
  return false;
}

// ── Default commands ─────────────────────────────────────────────
// These cover the three main tab views plus utility actions. The nav
// commands use clickNavButton so we don't need to modify App.tsx.
export function useDefaultCommands(onClose: () => void): Command[] {
  return useMemo(
    () => [
      {
        id: "go-sessions",
        label: "Go to Sessions",
        group: "Navigate",
        keywords: "sessions list home",
        perform: () => {
          clickNavButton("Sessions");
          onClose();
        },
      },
      {
        id: "go-new",
        label: "Go to New Task",
        group: "Navigate",
        keywords: "new task create session",
        perform: () => {
          clickNavButton("New");
          onClose();
        },
      },
      {
        id: "go-providers",
        label: "Go to Providers",
        group: "Navigate",
        keywords: "providers api keys models",
        perform: () => {
          clickNavButton("Providers");
          onClose();
        },
      },
      {
        id: "reload",
        label: "Reload App",
        group: "Actions",
        keywords: "reload refresh restart",
        perform: () => {
          window.location.reload();
        },
      },
      {
        id: "scroll-top",
        label: "Scroll to Top",
        group: "Actions",
        keywords: "scroll top up",
        perform: () => {
          const main = document.querySelector(".content");
          if (main) main.scrollTo({ top: 0, behavior: "smooth" });
          else window.scrollTo({ top: 0, behavior: "smooth" });
          onClose();
        },
      },
      {
        id: "install-pwa",
        label: "Install App",
        group: "Actions",
        keywords: "install pwa offline",
        perform: () => {
          // Trigger the InstallPrompt by clicking any Install button
          const btn = document.querySelector<HTMLButtonElement>(
            ".topbar-right button"
          );
          if (btn && /install/i.test(btn.textContent ?? "")) btn.click();
          onClose();
        },
      },
    ],
    [onClose]
  );
}

// ── Component ────────────────────────────────────────────────────
export function CommandPalette({ open, onClose, commands: extraCommands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const defaultCommands = useDefaultCommands(onClose);
  const commands = useMemo(
    () => [...(extraCommands ?? []), ...defaultCommands],
    [extraCommands, defaultCommands]
  );

  // Filtered + scored results
  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((cmd) => {
        const haystack = [cmd.label, cmd.keywords ?? "", cmd.group].join(" ");
        const score = fuzzyScore(query, haystack);
        return { cmd, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.cmd);
  }, [query, commands]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      // Slight delay to let AnimatePresence mount
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Clamp active index when results change
  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [results, activeIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        results[activeIndex]?.perform();
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          setActiveIndex((i) => (i - 1 + results.length) % results.length);
        } else {
          setActiveIndex((i) => (i + 1) % results.length);
        }
        break;
    }
  };

  // Group results for display
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of results) {
      (groups[cmd.group] ??= []).push(cmd);
    }
    return groups;
  }, [results]);

  // Flatten with group headers for rendering + index tracking
  const flatItems = useMemo(() => {
    let cmdIndex = 0;
    const out: Array<{ type: "group"; label: string } | { type: "command"; cmd: Command; index: number }> = [];
    for (const [group, cmds] of Object.entries(grouped)) {
      out.push({ type: "group", label: group });
      for (const cmd of cmds) {
        out.push({ type: "command", cmd, index: cmdIndex++ });
      }
    }
    return out;
  }, [grouped]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION_FAST, ease: EASE_OUT }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <motion.div
            className="cmdk-panel"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: DURATION_NORMAL, ease: EASE_OUT }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmdk-input-wrap">
              <svg
                className="cmdk-search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                className="cmdk-input"
                type="text"
                placeholder="Type a command or search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Search commands"
                aria-expanded="true"
                aria-controls="cmdk-list"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="cmdk-esc-hint">ESC</kbd>
            </div>

            <div className="cmdk-list" ref={listRef} id="cmdk-list" role="listbox">
              {results.length === 0 && (
                <div className="cmdk-empty">No results found</div>
              )}
              {flatItems.map((item) => {
                if (item.type === "group") {
                  return (
                    <div key={`g-${item.label}`} className="cmdk-group-label">
                      {item.label}
                    </div>
                  );
                }
                const { cmd, index } = item;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={cmd.id}
                    className={`cmdk-item ${isActive ? "active" : ""}`}
                    onClick={() => cmd.perform()}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className="cmdk-item-icon">{cmd.icon ?? "›"}</span>
                    <span className="cmdk-item-label">{cmd.label}</span>
                    {cmd.hint && <span className="cmdk-item-hint">{cmd.hint}</span>}
                  </button>
                );
              })}
            </div>

            <div className="cmdk-footer">
              <span className="cmdk-footer-hint">
                <kbd>↑</kbd><kbd>↓</kbd> navigate
              </span>
              <span className="cmdk-footer-hint">
                <kbd>↵</kbd> select
              </span>
              <span className="cmdk-footer-hint">
                <kbd>esc</kbd> close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Hotkey hook ──────────────────────────────────────────────────
// Listens for Cmd+K (macOS) / Ctrl+K (other platforms) to toggle the
// palette. Also closes on Escape if the palette is open.
export function useCommandPaletteHotkey(): [boolean, () => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+K on macOS, Ctrl+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      // Slash to open (like GitHub) — only when not typing in an input
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => setOpen((prev) => !prev);
  return [open, toggle];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
