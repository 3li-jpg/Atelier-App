import { useState } from "react";
import { motion } from "framer-motion";
import { isValidUrl, type FieldErrors } from "../lib.ts";
import { tapScale } from "../motion.ts";
import { RepoPicker } from "../components/RepoPicker.tsx";

// Step 3: Repo selection — uses RepoPicker (Vercel-style searchable dropdown
// for OAuth users, manual URL fallback for others).
export function StepRepo({ onDone, onBack }: {
  onDone: (repoUrl: string, branch: string) => void;
  onBack: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const e: FieldErrors = {};
    if (!repoUrl.trim()) e.repo_url = "required";
    else if (!isValidUrl(repoUrl)) e.repo_url = "invalid URL";
    if (!branch.trim()) e.branch = "required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate()) onDone(repoUrl.trim(), branch.trim() || "main");
  };

  return (
    <div className="onb-step">
      <h2 className="onb-step-title">Pick a repository</h2>
      <p className="onb-step-sub">
        Search your GitHub repos, or enter a URL manually.
      </p>

      <div className="form" style={{ marginTop: "0.5rem" }}>
        <RepoPicker
          repoUrl={repoUrl}
          branch={branch}
          onRepoChange={(url, defaultBranch) => { setRepoUrl(url); setBranch(defaultBranch); }}
          onBranchChange={(b) => setBranch(b)}
          errorRepo={errors.repo_url}
          errorBranch={errors.branch}
        />
      </div>

      <div className="onb-nav">
        <motion.button className="ghost" onClick={onBack}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >← Back</motion.button>
        <motion.button className="primary" onClick={next} disabled={!repoUrl.trim() || !branch.trim()}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >
          Continue →
        </motion.button>
      </div>
    </div>
  );
}
