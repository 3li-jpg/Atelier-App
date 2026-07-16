// Repos — the import-first creation flow. A workspace = a session whose task
// is optional (blank task = chat workspace). POST /sessions accepts optional
// task + optional toolsets[].
//
// States: loading → (not connected | connected). Connected shows a searchable
// repo list; selecting a repo opens an inline "New workspace" sheet.
import { useEffect, useState } from "react";
import { api, type RepoSummary, type BranchSummary, type ProviderSummary } from "../api.ts";
import { Button, useToast } from "@atelier/ui";
import { humanizeApiError, humanizeToast } from "./humanize.ts";
import "./repos.css";

type ToolsetDef = { id: string; label: string };

// ponytail: static table beats a registry; values are the raw toolset names
// sent to the API (TOOLSETS enum in @atelier/schema). delegation = "Subagents".
const TOOLSETS: ToolsetDef[] = [
  { id: "terminal", label: "Terminal" },
  { id: "file", label: "File editor" },
  { id: "code_execution", label: "Code execution" },
  { id: "web", label: "Web fetch" },
  { id: "search", label: "Web search" },
  { id: "browser", label: "Browser" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
  { id: "todo", label: "Todo list" },
  { id: "clarify", label: "Clarify" },
  { id: "delegation", label: "Subagents" },
];

const DEFAULT_TOOLSETS = [
  "terminal", "file", "code_execution", "web", "skills", "memory", "todo", "clarify",
];

type Phase = "loading" | "connect" | "ready";

export function Repos({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // sheet state (scoped to the selected repo)
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [task, setTask] = useState("");
  const [toolsets, setToolsets] = useState<string[]>(DEFAULT_TOOLSETS);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auth → repos. The /repos handler returns 401 {"error":"no github token"}
  // when the user has no stored GitHub token; detect that and show connect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getAuthStatus();
        if (cancelled) return;
        if (!status.oauth || !status.authed) { setPhase("connect"); return; }
        try {
          const rs = await api.listRepos();
          if (cancelled) return;
          setRepos(rs);
          setPhase("ready");
        } catch (e) {
          if (cancelled) return;
          // api.ts throws `Error("401 {\"error\":\"no github token\"}")`
          setPhase(String(e).includes("no github token") ? "connect" : "connect");
        }
      } catch {
        if (!cancelled) setPhase("connect");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  const selectedRepo = repos.find((r) => r.id === selectedId) ?? null;
  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;

  // Load branches for the selected repo. selectedRepo is a stable object ref
  // from repos[], so this effect does not loop on unrelated state changes.
  useEffect(() => {
    if (!selectedRepo) { setBranches(null); setBranch(""); return; }
    let cancelled = false;
    setBranches(null);
    const def = selectedRepo.default_branch || "main";
    setBranch(def);
    const [owner, repo] = selectedRepo.full_name.split("/");
    api.listBranches(owner, repo)
      .then((bs) => {
        if (cancelled) return;
        setBranches(bs);
        if (bs.length && !bs.some((b) => b.name === def)) setBranch(bs[0].name);
      })
      .catch(() => { if (!cancelled) setBranches(null); });
    return () => { cancelled = true; };
  }, [selectedRepo]);

  const filtered = query.trim()
    ? repos.filter((r) => r.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    : repos;

  const canSubmit = Boolean(
    selectedRepo && providers.length > 0 && providerId && modelId && branch && !submitting,
  );

  const toggleToolset = (id: string) =>
    setToolsets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  const onProviderChange = (id: string) => {
    setProviderId(id);
    setModelId("");
  };

  const cancel = () => {
    setSelectedId(null);
    setBranches(null);
    setBranch("");
    setProviderId("");
    setModelId("");
    setTask("");
    setToolsets(DEFAULT_TOOLSETS);
    setErr(null);
  };

  const submit = async () => {
    if (!selectedRepo || !providerId || !modelId || !branch) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await api.createSession({
        repo_url: `https://github.com/${selectedRepo.full_name}`,
        branch,
        provider_id: providerId,
        model_id: modelId,
        task: task.trim() || undefined,
        toolsets,
      });
      toast.push("Workspace created", "success");
      onCreated(res.id);
    } catch (e) {
      setErr(humanizeApiError(e).message);
      toast.push(humanizeToast(e), "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === "loading") {
    return <div className="rp-loading">Loading repositories…</div>;
  }

  if (phase === "connect") {
    return (
      <div className="rp-connect">
        <div className="rp-connect-card">
          <div className="rp-connect-mark">
            <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </div>
          <h3>Connect GitHub to import repos</h3>
          <p>Atelier reads your repositories so you can spin up a workspace in one click. We store your GitHub token to clone on your behalf.</p>
          <Button variant="primary" className="rp-connect-btn" onClick={() => { window.location.href = "/auth/github/login"; }}>
            Connect GitHub
          </Button>
          <p className="rp-connect-note">Read-only repo list · token stored encrypted</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-wrap">
      <div className="rp-search-wrap">
        <svg className="rp-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="5" />
          <path d="m11 11 3 3" strokeLinecap="round" />
        </svg>
        <input
          className="rp-search"
          placeholder="Search repositories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {repos.length === 0 ? (
        <div className="rp-empty">No repositories found on this account.</div>
      ) : filtered.length === 0 ? (
        <div className="rp-empty">No repositories match “{query.trim()}”.</div>
      ) : (
        <ul className="rp-list">
          {filtered.map((r) => {
            const slashIdx = r.full_name.indexOf("/");
            const owner = slashIdx >= 0 ? r.full_name.slice(0, slashIdx + 1) : "";
            const basename = slashIdx >= 0 ? r.full_name.slice(slashIdx + 1) : r.full_name;
            return (
            <li key={r.id}>
              <button
                type="button"
                className={`rp-repo${r.id === selectedId ? " selected" : ""}`}
                onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
              >
                <span className="rp-repo-name">
                  {owner && <span className="rp-repo-owner">{owner}</span>}
                  <span className="rp-repo-basename">{basename}</span>
                </span>
                <span className="rp-repo-meta">
                  {r.private && (
                    <span className="rp-badge rp-badge-private">private</span>
                  )}
                  <span className="rp-repo-default">
                    <svg className="rp-branch-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <circle cx="4" cy="3.5" r="1.5" />
                      <circle cx="4" cy="12.5" r="1.5" />
                      <circle cx="12" cy="3.5" r="1.5" />
                      <path d="M4 5v6" />
                      <path d="M12 5c0 3-4 2-4 5" />
                    </svg>
                    {r.default_branch}
                  </span>
                </span>
              </button>
              {r.id === selectedId && (
                <div className="rp-sheet">
                  <div className="rp-sheet-row">
                    {branches ? (
                      <label className="rp-field">
                        <span className="rp-field-label">Branch</span>
                        <select className="atelier-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
                          {branches.map((b) => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="rp-field">
                        <span className="rp-field-label">Branch</span>
                        <input
                          className="atelier-input"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        />
                        <span className="rp-field-hint">Loading branches…</span>
                      </label>
                    )}
                    {providers.length === 0 ? (
                      <p className="rp-hint">Add a provider first — open the Providers tab.</p>
                    ) : (
                      <label className="rp-field">
                        <span className="rp-field-label">Provider</span>
                        <select
                          className="atelier-select"
                          value={providerId}
                          onChange={(e) => onProviderChange(e.target.value)}
                        >
                          <option value="">select…</option>
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {selectedProvider && (
                      <label className="rp-field">
                        <span className="rp-field-label">Model</span>
                        <select
                          className="atelier-select"
                          value={modelId}
                          onChange={(e) => setModelId(e.target.value)}
                        >
                          <option value="">select…</option>
                        {selectedProvider.models.map((m) => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                        </select>
                      </label>
                    )}
                  </div>

                  <label className="rp-field">
                    <span className="rp-field-label">First message</span>
                    <textarea
                      className="rp-textarea"
                      rows={3}
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      placeholder="Leave empty to start a blank chat workspace"
                    />
                  </label>

                  <details className="rp-toolsets">
                    <summary className="rp-toolsets-label">Toolsets ({toolsets.length} enabled)</summary>
                    <div className="rp-toolset-grid">
                      {TOOLSETS.map((t) => (
                        <label key={t.id} className="rp-toolset">
                          <input
                            type="checkbox"
                            checked={toolsets.includes(t.id)}
                            onChange={() => toggleToolset(t.id)}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </details>

                  <div className="rp-actions">
                    <Button variant="ghost" onClick={cancel} disabled={submitting}>Cancel</Button>
                    <Button
                      variant="primary"
                      loading={submitting}
                      disabled={!canSubmit}
                      onClick={submit}
                    >
                      {submitting ? "creating…" : "Create workspace"}
                    </Button>
                  </div>
                  {err && <div className="rp-error">{err}</div>}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
