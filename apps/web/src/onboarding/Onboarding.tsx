import { Fragment, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../api.ts";
import { StepAuth } from "./StepAuth.tsx";
import { StepProvider } from "./StepProvider.tsx";
import { StepRepo } from "./StepRepo.tsx";
import { StepTask } from "./StepTask.tsx";
import { stepTransition, hoverLift } from "../motion.ts";
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
  // Track direction for slide animation: +1 forward, -1 back.
  const [direction, setDirection] = useState(1);
  const prevStep = useRef(0);

  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => setAuthStatus(null));
  }, []);

  // If already authed, auto-advance to step 1 (provider) on mount.
  useEffect(() => {
    if (authStatus?.authed && step === 0) setStep(1);
  }, [authStatus, step]);

  // Compute direction whenever step changes.
  useEffect(() => {
    setDirection(step >= prevStep.current ? 1 : -1);
    prevStep.current = step;
  }, [step]);

  const goForward = (next: Step) => { setDirection(1); setStep(next); };
  const goBack = (prev: Step) => { setDirection(-1); setStep(prev); };

  return (
    <div className="onboarding">
      <div className="onb-card">
        {/* Compact segmented progress */}
        <div className="onb-progress" aria-label={`Step ${step + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[step]}`}>
          <div className="onb-progress-meta">
            Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
          </div>
          <div className="onb-progress-track">
            {STEP_LABELS.map((_, i) => (
              <Fragment key={i}>
                {i > 0 && <div className="onb-bar" />}
                <div
                  className={`onb-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
                />
              </Fragment>
            ))}
          </div>
        </div>

        {/* Steps — animated with directional slide */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepTransition}
            initial="enter"
            animate="center"
            exit="exit"
            style={{ flex: 1, display: "flex", flexDirection: "column" }}
          >
            {step === 0 && (
              <StepAuth
                status={authStatus}
                onDone={() => {
                  // Refresh auth status after login/signup.
                  api.getAuthStatus().then(setAuthStatus).catch(() => {});
                  goForward(1);
                }}
              />
            )}

            {step === 1 && (
              <StepProvider
                onBack={() => goBack(0)}
                onDone={(pid) => {
                  setProviderId(pid);
                  goForward(2);
                }}
              />
            )}

            {step === 2 && (
              <StepRepo
                onBack={() => goBack(1)}
                onDone={(url, br) => {
                  setRepoUrl(url);
                  setBranch(br);
                  goForward(3);
                }}
              />
            )}

            {step === 3 && (
              <StepTask
                providerId={providerId}
                repoUrl={repoUrl}
                branch={branch}
                onBack={() => goBack(2)}
                onDone={(sessionId) => onComplete(sessionId)}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Skip link — lets existing users bail to the main app */}
        {step <= 1 && (
          <div className="onb-card-footer">
            <motion.button
              className="onb-skip-link"
              onClick={onSkip}
              variants={hoverLift}
              initial="rest"
              whileHover="hover"
            >
              Skip setup →
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
