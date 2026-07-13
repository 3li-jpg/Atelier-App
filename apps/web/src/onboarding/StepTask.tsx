import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, type ProviderSummary, type CreateSessionReq } from "../api.ts";
import type { FieldErrors } from "../lib.ts";
import { hoverLift, tapScale } from "../motion.ts";
import { humanizeApiError } from "../views/humanize.ts";

const EXAMPLE_PROMPTS = [
  "Fix the failing tests in src/auth.ts and explain what was wrong.",
  "Add a dark mode toggle to the settings page.",
  "Refactor the database layer to use connection pooling.",
  "Write unit tests for the utils/date.ts module.",
];

// Step 4: Task description + session creation. Shows a summary of all
// choices and example prompts. On submit, creates the session and hands
// off to the workspace (SessionView).
export function StepTask({ providerId, repoUrl, branch, onDone, onBack }: {
  providerId: string;
  repoUrl: string;
  branch: string;
  onDone: (sessionId: string) => void;
  onBack: () => void;
}) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [modelId, setModelId] = useState("");
  const [task, setTask] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load providers to find the selected one and its models. Pick the first
  // model only if the user hasn't already chosen one.
  useEffect(() => {
    api.listProviders().then((ps) => {
      setProviders(ps);
      const found = ps.find((p) => p.id === providerId);
      if (!modelId && found?.models[0]) setModelId(found.models[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const selected = providers.find((p) => p.id === providerId) ?? null;

  const validate = (): boolean => {
    const e: FieldErrors = {};
    if (!modelId) e.model_id = "select a model";
    if (!task.trim()) e.task = "required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const req: CreateSessionReq = {
        repo_url: repoUrl,
        branch,
        provider_id: providerId,
        model_id: modelId,
        task: task.trim(),
      };
      const res = await api.createSession(req);
      onDone(res.id);
    } catch (e2) {
      setErr(humanizeApiError(e2).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Skip: create the workspace with no initial prompt — the user lands in a
  // blank chat and types their first message there. createSession accepts an
  // optional task; omitting it yields a chat workspace.
  const skip = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await api.createSession({
        repo_url: repoUrl,
        branch,
        provider_id: providerId,
        model_id: modelId,
      });
      onDone(res.id);
    } catch (e2) {
      setErr(humanizeApiError(e2).message);
    } finally {
      setSubmitting(false);
    }
  };

  const repoShort = repoUrl.replace(/^https:\/\/github\.com\//, "");

  return (
    <div className="onb-step">
      <h2 className="onb-step-title">Start a chat</h2>
      <p className="onb-step-sub">Describe what you want built, or skip to a blank workspace and type your first message there.</p>

      {/* Summary card */}
      <div className="onb-summary">
        <div className="onb-summary-row">
          <span className="label">Repo</span>
          <span className="value">{repoShort}</span>
        </div>
        <div className="onb-summary-row">
          <span className="label">Branch</span>
          <span className="value">{branch}</span>
        </div>
        <div className="onb-summary-row">
          <span className="label">Provider</span>
          <span className="value">{selected?.name ?? providerId}</span>
        </div>
      </div>

      {/* Model selector */}
      {selected && (
        <div className="form">
          <label>Model
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">select…</option>
              {selected.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
            {errors.model_id && <span className="field-err">{errors.model_id}</span>}
          </label>
        </div>
      )}

      {/* Example prompts */}
      <div className="onb-task-examples">
        {EXAMPLE_PROMPTS.map((ex, i) => (
          <motion.button
            key={i}
            className="onb-task-example"
            onClick={() => setTask(ex)}
            variants={hoverLift}
            initial="rest"
            whileHover="hover"
            whileTap="hover"
          >
            {ex}
          </motion.button>
        ))}
      </div>

      {/* First message — optional. Leave empty to start a blank chat. */}
      <div className="form">
        <label>First message
          <textarea
            rows={4}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what you want built…"
          />
          {errors.task && <span className="field-err">{errors.task}</span>}
        </label>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="onb-nav">
        <motion.button className="ghost" onClick={onBack}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >← Back</motion.button>
        <motion.button className="primary" onClick={submit} disabled={submitting || !task.trim()}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >
          {submitting ? "starting…" : "Start chat →"}
        </motion.button>
      </div>
      <button
        type="button"
        className="onb-skip-blank"
        onClick={skip}
        disabled={submitting}
      >
        Skip — start a blank workspace
      </button>
    </div>
  );
}
