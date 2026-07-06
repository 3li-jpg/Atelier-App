// ponytail: view-state navigation (no router yet). Add history routing + deep
// links when PWA web-push lands (handoff T7.6) — that's what needs real URLs.
import { useState } from "react";
import { SessionsList } from "./views/SessionsList.tsx";
import { SessionView } from "./views/SessionView.tsx";
import { NewTask } from "./views/NewTask.tsx";
import { Providers } from "./views/Providers.tsx";
import { InstallPrompt } from "./InstallPrompt.tsx";
import { AuthBar } from "./AuthBar.tsx";

type View = { kind: "list" } | { kind: "new" } | { kind: "providers" } | { kind: "session"; id: string };

const TABS: { id: "list" | "new" | "providers"; label: string }[] = [
  { id: "list", label: "Sessions" },
  { id: "new", label: "New" },
  { id: "providers", label: "Providers" },
];

export function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  if (view.kind === "session") {
    return <SessionView id={view.id} onBack={() => setView({ kind: "list" })} />;
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>Atelier</h1>
        <div className="topbar-right">
          <InstallPrompt />
          <AuthBar />
        </div>
      </header>
      {authError && <div className="state-banner tone-bad">login failed: {authError}</div>}
      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={view.kind === t.id ? "active" : "ghost"}
            onClick={() => setView({ kind: t.id })}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {view.kind === "list" && <SessionsList onOpen={(id) => setView({ kind: "session", id })} />}
        {view.kind === "new" && <NewTask onCreated={(id) => setView({ kind: "session", id })} />}
        {view.kind === "providers" && <Providers />}
      </main>
    </div>
  );
}
