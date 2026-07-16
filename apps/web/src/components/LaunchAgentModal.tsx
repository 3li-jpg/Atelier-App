import { useEffect, useMemo, useState } from "react";
import { Button, useToast } from "@atelier/ui";
import { api, type ProviderSummary } from "../api.ts";
import { humanizeToast } from "../views/humanize.ts";
import "./launch-agent-modal.css";

export const VM_SIZES = [
  {
    id: "small",
    label: "Small",
    specs: "2 vCPU · 4 GB RAM · 40 GB",
    price: "$10/mo",
    cpus: 2,
    memory_mb: 4096,
  },
  {
    id: "medium",
    label: "Medium",
    specs: "4 vCPU · 8 GB RAM · 80 GB",
    price: "$20/mo",
    cpus: 4,
    memory_mb: 8192,
  },
  {
    id: "large",
    label: "Large",
    specs: "8 vCPU · 16 GB RAM · 160 GB",
    price: "$40/mo",
    cpus: 8,
    memory_mb: 16384,
  },
] as const;

type SizeId = (typeof VM_SIZES)[number]["id"];

export function LaunchAgentModal({
  onClose,
  onLaunched,
}: {
  onClose: () => void;
  onLaunched: (id: string) => void;
}) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [sizeId, setSizeId] = useState<SizeId>("small");
  const [repoUrl, setRepoUrl] = useState("");
  const [task, setTask] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vpsAgreed, setVpsAgreed] = useState(false);

  const size = VM_SIZES.find((s) => s.id === sizeId)!;

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  const defaultProvider = useMemo(() => {
    return providers[0] ?? null;
  }, [providers]);

  const defaultModel = useMemo(() => {
    return defaultProvider?.models[0]?.id ?? "";
  }, [defaultProvider]);

  const canLaunch = Boolean(defaultProvider && defaultModel && !loading && vpsAgreed);

  const launch = async () => {
    if (!canLaunch) return;
    setLoading(true);
    setErr(null);
    try {
      // ponytail: record VPS root-access terms acceptance before provisioning.
      await api.acceptLegal("vps-root-terms", "1.0").catch(() => {});
      const res = await api.createSession({
        provider_id: defaultProvider.id,
        model_id: defaultModel,
        repo_url: repoUrl.trim() || undefined,
        task: task.trim() || undefined,
        cpus: size.cpus,
        memory_mb: size.memory_mb,
      });
      onLaunched(res.id);
    } catch (e) {
      const msg = humanizeToast(e);
      setErr(msg);
      toast.push(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lam-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lam-modal" role="dialog" aria-modal="true" aria-labelledby="lam-title">
        <button className="lam-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="lam-header">
          <h2 id="lam-title">
            Launch a cloud agent
            <span className="lam-badge">opencode-web</span>
          </h2>
          <p className="lam-subtitle">
            Pick a size and click launch. We provision your remote workspace and route you to it once it&apos;s ready.
          </p>
        </div>

        <div className="lam-section">
          <h3 className="lam-section-title">Size</h3>
          <div className="lam-sizes">
            {VM_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={"lam-size" + (sizeId === s.id ? " active" : "")}
                onClick={() => setSizeId(s.id)}
                aria-pressed={sizeId === s.id}
              >
                <span className="lam-size-label">{s.label}</span>
                <span className="lam-size-specs">{s.specs}</span>
                <span className="lam-size-price">{s.price}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lam-section">
          <h3 className="lam-section-title">Repository (optional)</h3>
          <div className="lam-repo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="Paste a git URL or search your repos..."
            />
          </div>
          <p className="lam-help">
            Pick a connected repo or paste any git URL. Cloned into{" "}
            <code>/home/agent/workspace/&lt;repo&gt;</code> on first boot.
          </p>
        </div>

        <button
          type="button"
          className="lam-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          Show advanced options
          <svg className={showAdvanced ? "open" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {showAdvanced && (
          <div className="lam-advanced">
            <label className="lam-field">
              <span>Initial task</span>
              <input
                type="text"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe what the agent should do first..."
              />
            </label>
          </div>
        )}

        <p className="lam-disclaimer">
          Your agent boots with your Atelier plan wired into opencode and the CLI ready on the terminal.{" "}
          Your agent runs as root and is yours to operate. By launching, you accept responsibility for what you run on it.{" "}
          <a href="#" onClick={(e) => e.preventDefault()}>Terms of use</a>.
        </p>

        <label className="lam-disclaimer" style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
          <input type="checkbox" checked={vpsAgreed} onChange={(e) => setVpsAgreed(e.target.checked)} style={{ marginTop: "2px" }} />
          <span>I understand this VM runs as root and is mine to operate.</span>
        </label>

        {err && <p className="lam-error">{err}</p>}

        <div className="lam-actions">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={launch} disabled={!canLaunch} loading={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Launch for {size.price}
          </Button>
        </div>
      </div>
    </div>
  );
}
