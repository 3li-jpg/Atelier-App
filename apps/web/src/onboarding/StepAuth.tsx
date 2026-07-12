import { useState } from "react";
import { motion } from "framer-motion";
import { api, setAuthToken } from "../api.ts";
import { validateAuthForm, type FieldErrors } from "../lib.ts";
import { tapScale } from "../motion.ts";

type AuthStatus = {
  oauth: boolean;
  authed: boolean;
  owner: boolean;
  user: { login: string } | null;
};

// Step 1: Auth. Three paths:
//  - Already authed (cookie/bearer) → skip
//  - OAuth configured → "Continue with GitHub" button
//  - No OAuth → email/password signup or login
export function StepAuth({ status, onDone }: {
  status: AuthStatus | null;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already authed — show a continue button.
  if (status?.authed) {
    return (
      <div className="onb-step">
        <h2 className="onb-step-title">You're signed in</h2>
        <p className="onb-step-sub">
          Logged in as {status.user?.login ?? "owner"}. Continue to set up your model provider.
        </p>
        <div className="onb-nav">
          <motion.button className="primary" onClick={onDone}
            variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
          >Continue →</motion.button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    const e = validateAuthForm({ email, password });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = mode === "signup"
        ? await api.signup(email.trim(), password)
        : await api.login(email.trim(), password);
      // Store the session token so the API client sends it as Bearer.
      if (res.session_token) setAuthToken(res.session_token);
      onDone();
    } catch (e2) {
      setErr(String(e2).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onb-step">
      <h2 className="onb-step-title">Welcome to Atelier</h2>
      <p className="onb-step-sub">Sign up or log in to start coding with AI agents.</p>

      {status?.oauth && (
        <>
          <motion.button
            className="primary onb-oauth-btn"
            onClick={() => { window.location.href = "/auth/github/login"; }}
            variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
          >
            Continue with GitHub
          </motion.button>
          <div className="onb-auth-mode-toggle">
            <motion.button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}
              variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
            >Sign up</motion.button>
            <motion.button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}
              variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
            >Log in</motion.button>
          </div>
        </>
      )}

      {!status?.oauth && (
        <div className="onb-auth-mode-toggle">
          <motion.button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}
            variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
          >Sign up</motion.button>
          <motion.button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}
            variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
          >Log in</motion.button>
        </div>
      )}

      <div className="form">
        <label>Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {errors.email && <span className="field-err">{errors.email}</span>}
        </label>
        <label>Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 8 characters"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {errors.password && <span className="field-err">{errors.password}</span>}
        </label>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="onb-nav">
        <motion.button className="primary" onClick={submit} disabled={busy}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >
          {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
        </motion.button>
      </div>
    </div>
  );
}
