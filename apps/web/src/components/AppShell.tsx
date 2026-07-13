import type { ReactNode } from "react";
import { InstallPrompt } from "../InstallPrompt.tsx";

export type ShellView = { kind: "list" } | { kind: "new" } | { kind: "providers" };

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
  new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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
} as const;

const NAV: { id: ShellView["kind"]; label: string; icon: JSX.Element }[] = [
  { id: "list", label: "Sessions", icon: ICONS.list },
  { id: "new", label: "New Task", icon: ICONS.new },
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
      </nav>
    </div>
  );
}
