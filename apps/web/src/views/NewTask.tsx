import { useEffect, useState } from "react";
import { api, type ProviderSummary, type CreateSessionReq } from "../api.ts";
import { validateNewTask, type FieldErrors } from "../lib.ts";

// T7.3: NewTask form. ponytail: repo/branch typed manually — repo + branch
// listing lands with the GitHub App (handoff T5, GET /repos[/:id/branches]).
export function NewTask({ onCreated }: { onCreated: (id: string) => void }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({
    repo_url: "", branch: "main", provider_id: "", model_id: "", task: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listProviders().then(setProviders).catch(() => {}); }, []);

  const selected = providers.find((p) => p.id === form.provider_id) ?? null;

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
      };
      const res = await api.createSession(req);
      onCreated(res.id);
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  if (providers.length === 0) {
    return <p className="muted padded">add a provider first (Providers tab).</p>;
  }

  return (
    <div className="form padded">
      <label>Repo URL
        <input
          value={form.repo_url}
          onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
          placeholder="https://github.com/owner/repo"
        />
        {errors.repo_url && <span className="field-err">{errors.repo_url}</span>}
      </label>
      <label>Branch
        <input
          value={form.branch}
          onChange={(e) => setForm({ ...form, branch: e.target.value })}
          placeholder="main"
        />
        {errors.branch && <span className="field-err">{errors.branch}</span>}
      </label>
      <label>Provider
        <select
          value={form.provider_id}
          onChange={(e) => setForm({ ...form, provider_id: e.target.value, model_id: "" })}
        >
          <option value="">select…</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {errors.provider_id && <span className="field-err">{errors.provider_id}</span>}
      </label>
      {selected && (
        <label>Model
          <select value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })}>
            <option value="">select…</option>
            {selected.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          {errors.model_id && <span className="field-err">{errors.model_id}</span>}
        </label>
      )}
      <label>Task
        <textarea
          rows={4}
          value={form.task}
          onChange={(e) => setForm({ ...form, task: e.target.value })}
          placeholder="Describe what the agent should do…"
        />
        {errors.task && <span className="field-err">{errors.task}</span>}
      </label>
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={submitting} onClick={submit}>
        {submitting ? "starting…" : "Start session"}
      </button>
      <p className="muted small">repo/branch are typed manually for now — listing arrives with the GitHub App (T5).</p>
    </div>
  );
}
