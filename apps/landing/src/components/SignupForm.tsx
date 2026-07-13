"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import TransitionOverlay from "@/components/TransitionOverlay";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5199";

export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    let hasError = false;

    if (!/.+@.+\..+/.test(email)) {
      setEmailError("Enter a valid email address.");
      hasError = true;
    } else {
      setEmailError("");
    }

    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      hasError = true;
    } else {
      setPasswordError("");
    }

    if (hasError) return;

    setLoading(true);
    try {
      // Try sign up first
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        setFormError(signUpError.message);
        return;
      }

      // If session is active immediately, redirect
      if (signUpData.session) {
        const token = signUpData.session.access_token;
        setTransitioning(true);
        // Brief delay so the overlay paints before the cross-origin navigation
        // freezes the page. The web app's own loading state picks up from here.
        setTimeout(() => {
          window.location.href = `${DASHBOARD_URL}#token=${encodeURIComponent(token)}`;
        }, 350);
        return;
      }

      // No session — either email confirmation is required, or the user already
      // exists. Try signing in (covers the "already registered" case).
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // Can't sign in — email confirmation is required
        setFormError("Check your email for a confirmation link, then return to log in.");
        return;
      }

      if (signInData.session) {
        const token = signInData.session.access_token;
        setTransitioning(true);
        setTimeout(() => {
          window.location.href = `${DASHBOARD_URL}#token=${encodeURIComponent(token)}`;
        }, 350);
        return;
      }

      setFormError("Unable to create session. Please try again.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="join" className="section">
      <TransitionOverlay show={transitioning} message="Redirecting to dashboard…" />
      <div className="container">
        <header className="section-header" style={{ textAlign: "center" }}>
          <span className="section-eyebrow">Join</span>
          <h2 className="section-title" style={{ margin: "0 auto" }}>
            Create your account
          </h2>
        </header>

        <div className="signup-card reveal">
          <p
            style={{
              fontFamily: "var(--font-whyte)",
              fontSize: "14px",
              lineHeight: "var(--leading-body-sm)",
              color: "var(--color-steel)",
              marginBottom: "var(--spacing-24)",
              margin: "0 0 var(--spacing-24) 0",
            }}
          >
            Start free — bring your model key and run your first agent in under a minute.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "var(--spacing-16)" }}>
              <label className="signup-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                className="signup-input"
              />
              {emailError && (
                <span className="signup-error">{emailError}</span>
              )}
            </div>

            <div style={{ marginBottom: "var(--spacing-20)" }}>
              <label className="signup-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                disabled={loading}
                className="signup-input"
              />
              {passwordError && (
                <span className="signup-error">{passwordError}</span>
              )}
            </div>

            {formError && (
              <div
                style={{
                  marginBottom: "var(--spacing-16)",
                  color: "#f87171",
                  fontSize: 13,
                  fontFamily: "var(--font-whyte)",
                  textAlign: "center",
                }}
              >
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="signup-submit"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p
            style={{
              marginTop: "var(--spacing-20)",
              fontSize: 13,
              color: "var(--color-steel)",
              fontFamily: "var(--font-whyte)",
              textAlign: "center",
            }}
          >
            Already have an account?{" "}
            <a
              href={DASHBOARD_URL}
              style={{
                color: "var(--color-signal-violet)",
                textDecoration: "none",
              }}
            >
              Log in
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
