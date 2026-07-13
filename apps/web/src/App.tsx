// ponytail: view-state navigation + auth gate (no router yet). Add history
// routing + deep links when PWA web-push lands (handoff T7.6).
import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { pageTransition } from "./motion.ts";
import { api, setAuthToken } from "./api.ts";
import { AppShell, type ShellView } from "./components/AppShell.tsx";
import { PageHeader } from "./components/PageHeader.tsx";

// Code-split heavy views so the initial bundle stays small.
const SessionsList = lazy(() =>
  import("./views/SessionsList.tsx").then((m) => ({ default: m.SessionsList })),
);
const SessionView = lazy(() =>
  import("./views/SessionView.tsx").then((m) => ({ default: m.SessionView })),
);
const NewTask = lazy(() =>
  import("./views/NewTask.tsx").then((m) => ({ default: m.NewTask })),
);
const Providers = lazy(() =>
  import("./views/Providers.tsx").then((m) => ({ default: m.Providers })),
);
const Onboarding = lazy(() =>
  import("./onboarding/Onboarding.tsx").then((m) => ({ default: m.Onboarding })),
);

type View =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "providers" }
  | { kind: "session"; id: string }
  | { kind: "onboarding" };

const ONBOARDED_KEY = "atelier:onboarded";

type AuthState = "checking" | "authed" | "guest";

export function App() {
  const [view, setView] = useState<View>(() => {
    // Show onboarding for first-time users who haven't completed it.
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) return { kind: "onboarding" };
    } catch { /* private mode */ }
    return { kind: "list" };
  });
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  const [auth, setAuth] = useState<AuthState>("checking");
  const [user, setUser] = useState<{ login: string } | null>(null);
  const [oauth, setOauth] = useState(false);

  // ponytail: re-checks only while "checking" — once decided, stable. Re-trigger
  // after logout by resetting to "checking". Never runs during onboarding.
  useEffect(() => {
    if (view.kind === "onboarding") return;
    if (auth !== "checking") return;
    api.getAuthStatus()
      .then((s) => {
        setOauth(s.oauth);
        if (s.authed) {
          setAuth("authed");
          setUser(s.user);
        } else {
          setAuth("guest");
        }
      })
      .catch(() => setAuth("guest"));
  }, [view.kind, auth]);

  function logout() {
    api.logout().catch(() => {}); // ponytail: best-effort — clear local auth even if the call fails.
    setAuthToken("");
    setUser(null);
    setAuth("guest");
  }

  if (view.kind === "session") {
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait">
          <motion.div
            key="session"
            className="view-fade"
            variants={pageTransition}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ height: "100%" }}
          >
            <Suspense fallback={null}>
              <SessionView id={view.id} onBack={() => setView({ kind: "list" })} />
            </Suspense>
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
            className="view-fade"
            variants={pageTransition}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ height: "100%" }}
          >
            <Suspense fallback={null}>
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
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    );
  }

  if (auth === "checking") {
    return (
      <MotionConfig reducedMotion="user">
        <div className="boot-check">
          <div className="wordmark">Atelier</div>
          <SpinnerSVG />
          <p className="muted small">Loading workspace…</p>
        </div>
      </MotionConfig>
    );
  }

  if (auth === "guest") {
    return (
      <MotionConfig reducedMotion="user">
        <SignInCard
          oauth={oauth}
          initialError={authError ? "GitHub sign-in didn't complete — try again" : null}
          onSuccess={(u, token) => {
            setAuthToken(token);
            setUser(u);
            setAuth("authed");
          }}
        />
      </MotionConfig>
    );
  }

  // authed — session/onboarding are early-returned above, so view is list/new/providers.
  const shellView: ShellView =
    view.kind === "list" || view.kind === "new" || view.kind === "providers" ? view : { kind: "list" };

  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        view={shellView}
        setView={(v: ShellView) => setView(v)}
        user={user}
        onLogout={logout}
      >
        {view.kind === "list" && <PageHeader title="Sessions" subtitle="Your coding sessions" />}
        {view.kind === "new" && <PageHeader title="New Task" subtitle="Start a new coding session" />}
        {view.kind === "providers" && <PageHeader title="Providers" subtitle="Model providers and API keys" />}
        <AnimatePresence mode="wait">
          <motion.div key={view.kind} className="view-fade" variants={pageTransition} initial="initial" animate="animate" exit="exit">
            {view.kind === "list" && (
              <Suspense fallback={null}>
                <SessionsList onOpen={(id) => setView({ kind: "session", id })} />
              </Suspense>
            )}
            {view.kind === "new" && (
              <Suspense fallback={null}>
                <NewTask onCreated={(id) => setView({ kind: "session", id })} />
              </Suspense>
            )}
            {view.kind === "providers" && (
              <Suspense fallback={null}>
                <Providers />
              </Suspense>
            )}
          </motion.div>
        </AnimatePresence>
      </AppShell>
    </MotionConfig>
  );
}

function SpinnerSVG() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

function SignInCard({
  oauth,
  initialError,
  onSuccess,
}: {
  oauth: boolean;
  initialError: string | null;
  onSuccess: (u: { login: string }, token: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = mode === "login"
        ? await api.login(email, password)
        : await api.signup(email, password);
      onSuccess(res.user, res.session_token);
    } catch {
      setError(mode === "login" ? "Wrong email or password" : "Couldn't sign up — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h2>Welcome back to Atelier</h2>
        <div className="auth-tabs">
          <button className={"auth-tab" + (mode === "login" ? " active" : "")} onClick={() => { setMode("login"); setError(null); }}>Log in</button>
          <button className={"auth-tab" + (mode === "signup" ? " active" : "")} onClick={() => { setMode("signup"); setError(null); }}>Sign up</button>
        </div>
        <form className="form" onSubmit={onSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={submitting}>
              {mode === "login" ? "Log in" : "Sign up"}
            </button>
          </div>
        </form>
        {oauth && (
          <button className="ghost" onClick={() => { window.location.href = "/auth/github/login"; }}>
            Continue with GitHub
          </button>
        )}
      </div>
    </div>
  );
}
