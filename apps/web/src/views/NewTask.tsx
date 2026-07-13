import { useEffect, useState } from "react";
import { api, type ProviderSummary, type CreateSessionReq } from "../api.ts";
import { validateNewTask, type FieldErrors } from "../lib.ts";
import { Select, Textarea, Button, Card, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";

// T7.3: NewTask form. Uses RepoPicker for Vercel-style repo selection
// (searchable dropdown for OAuth users, manual URL fallback for others).
export function NewTask({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({
    repo_url: "", branch: "main", provider_id: "", model_id: "", task: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

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
      toast.push("Session started", "success");
      onCreated(res.id);
    } catch (e2) {
      const msg = String(e2).replace(/^Error:\s*/, "");
      setErr(msg);
      toast.push(`Failed to start session: ${msg.slice(0, 80)}`, "error");
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
    <Card className="padded" style={{ border: "none", background: "transparent", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <RepoPicker
        repoUrl={form.repo_url}
        branch={form.branch}
        onRepoChange={(url, defaultBranch) => setForm((f) => ({ ...f, repo_url: url, branch: defaultBranch }))}
        onBranchChange={(b) => setForm((f) => ({ ...f, branch: b }))}
        errorRepo={errors.repo_url}
        errorBranch={errors.branch}
      />
      <Select
        label="Provider"
        value={form.provider_id}
        onChange={(e) => setForm({ ...form, provider_id: e.target.value, model_id: "" })}
        error={errors.provider_id}
      >
        <option value="">select…</option>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      {selected && (
        <Select
          label="Model"
          value={form.model_id}
          onChange={(e) => setForm({ ...form, model_id: e.target.value })}
          error={errors.model_id}
        >
          <option value="">select…</option>
          {selected.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </Select>
      )}
      <Textarea
        label="Task"
        rows={4}
        value={form.task}
        onChange={(e) => setForm({ ...form, task: e.target.value })}
        placeholder="Describe what the agent should do…"
        error={errors.task}
      />
      {err && <div className="error">{err}</div>}
      <Button variant="primary" disabled={submitting} onClick={submit} loading={submitting}>
        {submitting ? "starting…" : "Start session"}
      </Button>
    </Card>
  );
}
