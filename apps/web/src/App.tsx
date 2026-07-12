// ponytail: view-state navigation (no router yet). Add history routing + deep
// links when PWA web-push lands (handoff T7.6) — that's what needs real URLs.
import { useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { SessionsList } from "./views/SessionsList.tsx";
import { SessionView } from "./views/SessionView.tsx";
import { NewTask } from "./views/NewTask.tsx";
import { Providers } from "./views/Providers.tsx";
import { InstallPrompt } from "./InstallPrompt.tsx";
import { AuthBar } from "./AuthBar.tsx";
import { Onboarding } from "./onboarding/Onboarding.tsx";
import { pageTransition, tapScale } from "./motion.ts";

type View =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "providers" }
  | { kind: "session"; id: string }
  | { kind: "onboarding" };

const TABS: { id: "list" | "new" | "providers"; label: string }[] = [
  { id: "list", label: "Sessions" },
  { id: "new", label: "New" },
  { id: "providers", label: "Providers" },
];

const ONBOARDED_KEY = "atelier:onboarded";

export function App() {
  const [view, setView] = useState<View>(() => {
    // Show onboarding for first-time users who haven't completed it.
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) return { kind: "onboarding" };
    } catch { /* private mode */ }
    return { kind: "list" };
  });
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  if (view.kind === "session") {
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait">
          <motion.div
            key="session"
            variants={pageTransition}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ height: "100%" }}
          >
            <SessionView id={view.id} onBack={() => setView({ kind: "list" })} />
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    );
  }

  if (view.kind === "onboarding") {
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait">
          <motion.div
            key="onboarding"
            variants={pageTransition}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ height: "100%" }}
          >
            <Onboarding
              onComplete={(sessionId) => {
                try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* private mode */ }
                setView({ kind: "session", id: sessionId });
              }}
              onSkip={() => {
                try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* private mode */ }
                setView({ kind: "list" });
              }}
            />
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
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
            <motion.button
              key={t.id}
              className={view.kind === t.id ? "active" : "ghost"}
              onClick={() => setView({ kind: t.id })}
              variants={tapScale}
              initial="rest"
              whileHover="hover"
              whileTap="pressed"
            >
              {t.label}
            </motion.button>
          ))}
        </nav>
        <main className="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={view.kind}
              variants={pageTransition}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {view.kind === "list" && <SessionsList onOpen={(id) => setView({ kind: "session", id })} />}
              {view.kind === "new" && <NewTask onCreated={(id) => setView({ kind: "session", id })} />}
              {view.kind === "providers" && <Providers />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}
