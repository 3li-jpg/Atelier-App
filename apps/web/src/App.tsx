// ponytail: view-state navigation (no router yet). Add history routing + deep
// links when PWA web-push lands (handoff T7.6) — that's what needs real URLs.
import { useState } from "react";
import { SessionsList } from "./views/SessionsList.tsx";
import { SessionView } from "./views/SessionView.tsx";

type View = { kind: "list" } | { kind: "session"; id: string };

export function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "list") {
    return <SessionsList onOpen={(id) => setView({ kind: "session", id })} />;
  }
  return <SessionView id={view.id} onBack={() => setView({ kind: "list" })} />;
}
