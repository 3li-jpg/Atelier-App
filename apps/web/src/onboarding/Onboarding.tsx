import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { StepAuth } from "./StepAuth.tsx";
import { StepProvider } from "./StepProvider.tsx";
import { StepRepo } from "./StepRepo.tsx";
import { StepTask } from "./StepTask.tsx";
import "./onboarding.css";

type AuthStatus = {
  oauth: boolean;
  authed: boolean;
  owner: boolean;
  user: { login: string } | null;
} | null;

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Account", "Model", "Repo", "Task"];

// Guided onboarding flow: auth → BYOK → repo → task → workspace.
// The parent App decides whether to show Onboarding or the main app.
// On completion (session created), calls onComplete(sessionId) which
// App uses to switch to SessionView.
export function Onboarding({ onComplete, onSkip }: {
  onComplete: (sessionId: string) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(null);
  const [providerId, setProviderId] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");

  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => setAuthStatus(null));
  }, []);

  // If already authed, auto-advance to step 1 (provider) on mount.
  useEffect(() => {
    if (authStatus?.authed && step === 0) setStep(1);
  }, [authStatus, step]);

  return (
    <div className="onboarding">
      {/* Progress indicator */}
      <div className="onb-progress">
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {i > 0 && <div className="onb-step-bar" />}
            <div className={`onb-step-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
              <span className="dot" />
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Steps */}
      {step === 0 && (
        <StepAuth
          status={authStatus}
          onDone={() => {
            // Refresh auth status after login/signup.
            api.getAuthStatus().then(setAuthStatus).catch(() => {});
            setStep(1);
          }}
        />
      )}

      {step === 1 && (
        <StepProvider
          onBack={() => setStep(0)}
          onDone={(pid) => {
            setProviderId(pid);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <StepRepo
          onBack={() => setStep(1)}
          onDone={(url, br) => {
            setRepoUrl(url);
            setBranch(br);
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <StepTask
          providerId={providerId}
          repoUrl={repoUrl}
          branch={branch}
          onBack={() => setStep(2)}
          onDone={(sessionId) => onComplete(sessionId)}
        />
      )}

      {/* Skip link — lets existing users bail to the main app */}
      {step <= 1 && (
        <div className="onb-nav" style={{ justifyContent: "center" }}>
          <button className="onb-skip ghost" onClick={onSkip}>
            Skip setup →
          </button>
        </div>
      )}
    </div>
  );
}
