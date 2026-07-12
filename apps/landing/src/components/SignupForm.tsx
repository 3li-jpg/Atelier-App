"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import TransitionOverlay from "@/components/TransitionOverlay";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:5173";

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
    <section id="join" style={{ padding: "80px 0" }}>
      <TransitionOverlay show={transitioning} message="Redirecting to dashboard…" />
      <div className="container">
        <div className="section-stamp">J O I N</div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
          style={{
            maxWidth: 480,
            margin: "24px auto 0",
            background: "rgba(247,249,250,0.03)",
            border: "1px solid rgba(247,249,250,0.15)",
            borderRadius: "19.2px",
            padding: 40,
          }}
        >
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(247,249,250,0.05)",
                  border: "1px solid rgba(247,249,250,0.2)",
                  borderRadius: 8,
                  padding: 16,
                  color: "#fff",
                  fontSize: 15,
                  fontFamily: "Inter, sans-serif",
                  outline: "none",
                }}
              />
              {emailError && (
                <span
                  style={{
                    display: "block",
                    marginTop: 6,
                    color: "#f87171",
                    fontSize: 12,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {emailError}
                </span>
              )}
            </div>

            <div style={{ marginBottom: 24 }}>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                disabled={loading}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(247,249,250,0.05)",
                  border: "1px solid rgba(247,249,250,0.2)",
                  borderRadius: 8,
                  padding: 16,
                  color: "#fff",
                  fontSize: 15,
                  fontFamily: "Inter, sans-serif",
                  outline: "none",
                }}
              />
              {passwordError && (
                <span
                  style={{
                    display: "block",
                    marginTop: 6,
                    color: "#f87171",
                    fontSize: 12,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {passwordError}
                </span>
              )}
            </div>

            {formError && (
              <div
                style={{
                  marginBottom: 16,
                  color: "#f87171",
                  fontSize: 13,
                  fontFamily: "Inter, sans-serif",
                  textAlign: "center",
                }}
              >
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                background: "#af50ff",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: 16,
                fontSize: 15,
                fontFamily: "Inter, sans-serif",
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p
            style={{
              marginTop: 20,
              fontSize: 12,
              color: "#8a8f98",
              fontFamily: "Inter, sans-serif",
              textAlign: "center",
            }}
          >
            Already have an account?{" "}
            <a
              href={DASHBOARD_URL}
              style={{
                color: "#af50ff",
                textDecoration: "none",
              }}
            >
              Log in
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
