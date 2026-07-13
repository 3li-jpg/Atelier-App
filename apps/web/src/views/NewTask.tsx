import { useEffect, useState } from "react";
import { api, type ProviderSummary, type CreateSessionReq } from "../api.ts";
import { validateNewTask, type FieldErrors } from "../lib.ts";
import { Select, Textarea, Button, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { humanizeApiError, humanizeToast } from "./humanize.ts";
import "./new-task.css";

type PermissionMode = "auto" | "review" | "plan";

const EXAMPLE_PROMPTS = [
  "Fix the failing tests in src/auth.ts",
  "Add a dark mode toggle to the settings page",
  "Write unit tests for utils/date.ts",
];

// T7.3: NewTask form. Uses RepoPicker for Vercel-style repo selection
// (searchable dropdown for OAuth users, manual URL fallback for others).
export function NewTask({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({
    repo_url: "",
    branch: "main",
    provider_id: "",
    model_id: "",
    task: "",
    permission_mode: "auto" as PermissionMode,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  const selected = providers.find((p) => p.id === form.provider_id) ?? null;

  const canSubmit = Boolean(
    form.repo_url.trim() &&
      form.branch.trim() &&
      form.provider_id &&
      form.model_id &&
      form.task.trim(),
  );

  const submit = async () => {
    const e = validateNewTask(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitting(true);
    setErr(null);
    try {
      const req: CreateSessionReq = {
        repo_url: form.repo_url.trim(),
        branch: form.branch.trim() || "main",
        provider_id: form.provider_id,
        model_id: form.model_id,
        task: form.task.trim(),
        permission_mode: form.permission_mode,
      };
      const res = await api.createSession(req);
      toast.push("Session started", "success");
      onCreated(res.id);
    } catch (e2) {
      setErr(humanizeApiError(e2).message);
      toast.push(humanizeToast(e2), "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (providers.length === 0) {
    return (
      <StateMessage
        kind="info"
        title="Add a provider first"
        description="You need at least one model provider before creating a session. Switch to the Providers tab to add one."
      />
    );
  }

  return (
    <div className="new-task">
      <RepoPicker
        repoUrl={form.repo_url}
        branch={form.branch}
        onRepoChange={(url, defaultBranch) =>
          setForm((f) => ({ ...f, repo_url: url, branch: defaultBranch }))
        }
        onBranchChange={(b) => setForm((f) => ({ ...f, branch: b }))}
        errorRepo={errors.repo_url}
        errorBranch={errors.branch}
      />
      <Select
        label="Provider"
        value={form.provider_id}
        onChange={(e) =>
          setForm((f) => ({ ...f, provider_id: e.target.value, model_id: "" }))
        }
        error={errors.provider_id}
      >
        <option value="">select…</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {selected && (
        <Select
          label="Model"
          value={form.model_id}
          onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))}
          error={errors.model_id}
        >
          <option value="">select…</option>
          {selected.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </Select>
      )}
      <Select
        label="Permission mode"
        value={form.permission_mode}
        onChange={(e) =>
          setForm((f) => ({ ...f, permission_mode: e.target.value as PermissionMode }))
        }
      >
        <option value="auto">Autonomous</option>
        <option value="review">Review changes</option>
        <option value="plan">Plan first</option>
      </Select>
      <p className="new-task-hint">
        auto = agent acts freely · review = asks before applying · plan = plans then waits
      </p>
      <div className="new-task-chips">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            className="new-task-chip"
            onClick={() => setForm((f) => ({ ...f, task: p }))}
          >
            {p}
          </button>
        ))}
      </div>
      <Textarea
        label="Task"
        rows={4}
        value={form.task}
        onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
        placeholder="e.g. Add a login page with email + Google OAuth, then wire it to the existing /auth API."
        error={errors.task}
      />
      {err && <div className="new-task-error">{err}</div>}
      <Button
        variant="primary"
        loading={submitting}
        disabled={!canSubmit || submitting}
        onClick={submit}
      >
        {submitting ? "starting…" : "Start session"}
      </Button>
    </div>
  );
}
