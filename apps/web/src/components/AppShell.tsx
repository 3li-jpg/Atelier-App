import type { ReactNode } from "react";
import { InstallPrompt } from "../InstallPrompt.tsx";

// ponytail: "new" removed — Repos replaces New Task as the creation entry.
// App.tsx owns the routing change; the union just drops the kind here.
export type ShellView =
  | { kind: "list" }
  | { kind: "repos" }
  | { kind: "providers" }
  | { kind: "settings" };

// ponytail: plain buttons + CSS classes, no framer-motion in the shell — keeps the
// chrome layer light; per-view transitions stay owned by App.tsx's AnimatePresence.
const ICONS = {
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  ),
  repos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h10a2 2 0 0 1 2 2v14" />
      <path d="M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  ),
  providers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <line x1="8" y1="7" x2="8.01" y2="7" />
      <line x1="8" y1="17" x2="8.01" y2="17" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
} as const;

const NAV: { id: ShellView["kind"]; label: string; icon: JSX.Element }[] = [
  { id: "repos", label: "Repos", icon: ICONS.repos },
  { id: "list", label: "Workspaces", icon: ICONS.list },
  { id: "providers", label: "Providers", icon: ICONS.providers },
];

export function AppShell({
  view,
  setView,
  user,
  onLogout,
  children,
}: {
  view: ShellView;
  setView: (v: ShellView) => void;
  user: { login: string } | null;
  onLogout: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="app-shell">
      <aside className="shell-sidebar">
        <div className="shell-wordmark">Atelier</div>
        <nav className="shell-nav">
          {NAV.map((t) => (
            <button
              key={t.id}
              className={"shell-nav-item" + (view.kind === t.id ? " active" : "")}
              onClick={() => setView({ kind: t.id } as ShellView)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="shell-user">
          <button
            className={"shell-nav-item" + (view.kind === "settings" ? " active" : "")}
            onClick={() => setView({ kind: "settings" })}
            aria-label="Settings"
          >
            {ICONS.settings}
            <span>Settings</span>
          </button>
          <span className="small muted">{user?.login ?? "account"}</span>
          <button className="ghost small" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <header className="shell-mobile-header">
        <div className="shell-wordmark">Atelier</div>
        <InstallPrompt />
      </header>

      <main className="shell-content">{children}</main>

      <nav className="shell-tabbar">
        {NAV.map((t) => (
          <button
            key={t.id}
            className={"shell-tab" + (view.kind === t.id ? " active" : "")}
            onClick={() => setView({ kind: t.id } as ShellView)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <button
          key="settings"
          className={"shell-tab" + (view.kind === "settings" ? " active" : "")}
          onClick={() => setView({ kind: "settings" })}
          aria-label="Settings"
        >
          {ICONS.settings}
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
