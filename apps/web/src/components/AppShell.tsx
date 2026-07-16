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

const LOGOMARK = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect width="20" height="20" rx="5" fill="url(#atelier-mark)" />
    <path d="M6 14 L10 5.5 L14 14" stroke="#fffdf9" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <line x1="7.4" y1="11.2" x2="12.6" y2="11.2" stroke="#fffdf9" strokeWidth={1.8} strokeLinecap="round" />
    <defs>
      <linearGradient id="atelier-mark" x1="0" y1="0" x2="20" y2="20" gradientUnits="userSpaceOnUse">
        <stop stopColor="#a07bff" />
        <stop offset="1" stopColor="#8b45e6" />
      </linearGradient>
    </defs>
  </svg>
);

const LOGOUT_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 17l5-5-5-5" />
    <path d="M20 12H9" />
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  </svg>
);

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
        <div className="shell-wordmark">
          {LOGOMARK}
          <span>Atelier</span>
        </div>
        <nav className="shell-nav">
          {NAV.map((t) => (
            <button
              key={t.id}
              className={"shell-nav-item" + (view.kind === t.id ? " active" : "")}
              onClick={() => setView({ kind: t.id } as ShellView)}
              aria-label={t.label}
              aria-current={view.kind === t.id ? "page" : undefined}
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
            aria-current={view.kind === "settings" ? "page" : undefined}
          >
            {ICONS.settings}
            <span>Settings</span>
          </button>
          <div className="shell-account">
            <span className="shell-avatar" aria-hidden="true">
              {(user?.login ?? "A").charAt(0).toUpperCase()}
            </span>
            <span className="shell-user-email" title={user?.login ?? "account"}>
              {user?.login ?? "account"}
            </span>
            <button className="shell-logout" onClick={onLogout} aria-label="Log out" title="Log out">
              {LOGOUT_ICON}
            </button>
          </div>
        </div>
      </aside>

      <header className="shell-mobile-header">
        <div className="shell-wordmark">
          {LOGOMARK}
          <span>Atelier</span>
        </div>
        <InstallPrompt />
      </header>

      <main className="shell-content">{children}</main>

      <nav className="shell-tabbar">
        {NAV.map((t) => (
          <button
            key={t.id}
            className={"shell-tab" + (view.kind === t.id ? " active" : "")}
            onClick={() => setView({ kind: t.id } as ShellView)}
            aria-label={t.label}
            aria-current={view.kind === t.id ? "page" : undefined}
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
          aria-current={view.kind === "settings" ? "page" : undefined}
        >
          {ICONS.settings}
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
