import { useEffect, useState } from "react";
import { api, type ProviderSummary, type CreateSessionReq, type RepoSummary, type BranchSummary } from "../api.ts";
import { validateNewTask, type FieldErrors } from "../lib.ts";
import { Input, Select, Textarea, Button, Card, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";

// T7.3: NewTask form. OAuth users browse their own repos via GET /repos;
// AUTH_TOKEN/dev mode falls back to manual repo_url + branch entry.
export function NewTask({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({
    repo_url: "", branch: "main", provider_id: "", model_id: "", task: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [useRepoPicker, setUseRepoPicker] = useState(false);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
    api.getAuthStatus().then((st) => {
      if (st.oauth && st.authed) {
        setUseRepoPicker(true);
        api.listRepos().then(setRepos).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const selectedFullName = form.repo_url.startsWith("https://github.com/")
    ? form.repo_url.slice("https://github.com/".length)
    : "";

  const onRepoChange = (fullName: string) => {
    setBranches([]);
    if (!fullName) {
      setForm((f) => ({ ...f, repo_url: "", branch: "main" }));
      return;
    }
    const r = repos.find((x) => x.full_name === fullName);
    setForm((f) => ({ ...f, repo_url: `https://github.com/${fullName}`, branch: r?.default_branch || "main" }));
    const [owner, repo] = fullName.split("/");
    api.listBranches(owner, repo).then(setBranches).catch(() => {});
  };

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
      {useRepoPicker ? (
        <>
          <Select
            label="Repo"
            value={selectedFullName}
            onChange={(e) => onRepoChange(e.target.value)}
            error={errors.repo_url}
          >
            <option value="">select…</option>
            {repos.map((r) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
          </Select>
          <Select
            label="Branch"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            error={errors.branch}
          >
            {(branches.length ? branches : [{ name: form.branch }]).map((b) => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </Select>
        </>
      ) : (
        <>
          <Input
            label="Repo URL"
            value={form.repo_url}
            onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
            placeholder="https://github.com/owner/repo"
            error={errors.repo_url}
          />
          <Input
            label="Branch"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            placeholder="main"
            error={errors.branch}
          />
        </>
      )}
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
      {useRepoPicker
        ? <p className="muted small">repos listed from your GitHub account; the agent clones+pushes as you.</p>
        : <p className="muted small">repo/branch are typed manually for now — listing arrives with the GitHub App (T5).</p>}
    </Card>
  );
}
