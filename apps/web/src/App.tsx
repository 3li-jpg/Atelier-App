// ponytail: minimal hash routing. No router lib — a View↔hash map +
// pushState/popstate. Onboarding still takes precedence over any hash (a
// not-yet-onboarded user landing on #/w/abc sees onboarding, not the gate).
import { lazy, Suspense, useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
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
const Providers = lazy(() =>
  import("./views/Providers.tsx").then((m) => ({ default: m.Providers })),
);
const Repos = lazy(() => import("./views/Repos.tsx").then((m) => ({ default: m.Repos })));
const Settings = lazy(() => import("./views/Settings.tsx").then((m) => ({ default: m.Settings })));
const Onboarding = lazy(() =>
  import("./onboarding/Onboarding.tsx").then((m) => ({ default: m.Onboarding })),
);

type View =
  | { kind: "list" }
  | { kind: "repos" }
  | { kind: "providers" }
  | { kind: "settings" }
  | { kind: "session"; id: string }
  | { kind: "onboarding" };

const ONBOARDED_KEY = "atelier:onboarded";

type AuthState = "checking" | "authed" | "guest";

// ── Hash routing ──────────────────────────────────────────────────────────
// Views ↔ hashes: #/workspaces (default), #/repos, #/providers, #/settings,
// #/w/<id> (session). Onboarding keeps no hash — it precedes routing entirely.
// `history.pushState` drives nav; `popstate`/`hashchange` sync Back/Forward.
// The session id is encoded into the path segment; `encodeURIComponent` keeps
// slashes / special chars out of the hash. `decodeURIComponent` + a fallback
// to `list` keep malformed hashes from crashing the app.

function viewToHash(view: View): string | null {
  switch (view.kind) {
    case "list": return "#/workspaces";
    case "repos": return "#/repos";
    case "providers": return "#/providers";
    case "settings": return "#/settings";
    case "session": return `#/w/${encodeURIComponent(view.id)}`;
    // onboarding owns the URL (no hash) until it completes.
    case "onboarding": return null;
  }
}

function hashToView(hash: string): View {
  // Strip leading '#'.
  const path = hash.replace(/^#/, "");
  if (path === "/workspaces" || path === "/") return { kind: "list" };
  if (path === "/repos") return { kind: "repos" };
  if (path === "/providers") return { kind: "providers" };
  if (path === "/settings") return { kind: "settings" };
  const sessionMatch = path.match(/^\/w\/(.+)$/);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    if (id) return { kind: "session", id };
  }
  // Unknown hash → list (the documented fallback).
  return { kind: "list" };
}

export function App() {
  const [view, setView] = useState<View>(() => {
    // Onboarding takes precedence: a not-yet-onboarded browser shows onboarding
    // regardless of the hash (the hash is read after onboarding completes).
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) return { kind: "onboarding" };
    } catch { /* private mode */ }
    // ponytail: unknown/empty hash → list (hashToView's documented fallback).
    return hashToView(window.location.hash);
  });
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  const [auth, setAuth] = useState<AuthState>("checking");
  const [user, setUser] = useState<{ login: string } | null>(null);
  const [oauth, setOauth] = useState(false);

  // ponytail: push state on view change — only when the hash actually differs,
  // so programmatic + browser-driven changes don't loop (popstate handler
  // updates state without pushing back). Guard against onboarding (no hash).
  useEffect(() => {
    const nextHash = viewToHash(view);
    if (nextHash === null) return; // onboarding owns the URL.
    if (window.location.hash === nextHash) return; // already there.
    history.pushState(null, "", nextHash);
  }, [view]);

  // Back/Forward: hash changes → read it back into state. No push here, so the
  // above effect won't re-fire a pushState (the hash already matches by then).
  useEffect(() => {
    const onPop = () => setView(hashToView(window.location.hash));
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

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

  // View switching uses plain keyed divs + the CSS .view-fade entrance.
  // AnimatePresence mode="wait" holds the OLD view until a framer rAF tick
  // confirms exit — in throttled tabs/webviews that tick can never come and
  // the app strands on the previous view. CSS needs no such confirmation.
  // Auth gate: a guest deep-linking #/w/<id> falls through to the sign-in card
  // below, then lands on the session after login — `view` keeps the requested
  // id, no separate stash needed.
  if (view.kind === "session" && auth === "authed") {
    return (
      <MotionConfig reducedMotion="user">
        <div key="session" className="view-fade" style={{ height: "100%" }}>
          <Suspense fallback={null}>
            <SessionView id={view.id} onBack={() => setView({ kind: "list" })} onOpenSession={(id) => setView({ kind: "session", id })} />
          </Suspense>
        </div>
      </MotionConfig>
    );
  }

  if (view.kind === "onboarding") {
    return (
      <MotionConfig reducedMotion="user">
        <div key="onboarding" className="view-fade" style={{ height: "100%" }}>
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
        </div>
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

  // authed — session/onboarding are early-returned above, so view is list/repos/providers/settings.
  const shellView: ShellView =
    view.kind === "list" || view.kind === "repos" || view.kind === "providers" || view.kind === "settings"
      ? view
      : { kind: "list" };

  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        view={shellView}
        setView={(v: ShellView) => setView(v)}
        user={user}
        onLogout={logout}
      >
        {view.kind === "list" && <PageHeader title="Workspaces" subtitle="Your chat workspaces" />}
        {view.kind === "repos" && <PageHeader title="Repos" subtitle="Import a repo to start a workspace" />}
        {view.kind === "providers" && <PageHeader title="Providers" subtitle="Model providers and API keys" />}
        {view.kind === "settings" && <PageHeader title="Settings" subtitle="Account, plan, and compute" />}
        <div key={view.kind} className="view-fade">
          {view.kind === "list" && (
            <Suspense fallback={null}>
              <SessionsList onOpen={(id) => setView({ kind: "session", id })} />
            </Suspense>
          )}
          {view.kind === "repos" && (
            <Suspense fallback={null}>
              <Repos onCreated={(id) => setView({ kind: "session", id })} />
            </Suspense>
          )}
          {view.kind === "providers" && (
            <Suspense fallback={null}>
              <Providers />
            </Suspense>
          )}
          {view.kind === "settings" && (
            <Suspense fallback={null}>
              <Settings onLogout={logout} />
            </Suspense>
          )}
        </div>
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
