import { useEffect, useState } from "react";
import { api, type Account, type ComputeProvider } from "../api.ts";
import { Button, Input, Select, useToast } from "@atelier/ui";
import { humanizeApiError } from "./humanize.ts";
import "./settings.css";

// humanizeSeconds: billed_seconds -> "Xh Ym". 0 / sub-minute -> "0m".
// ponytail: floor math beats a duration lib; switch if we ever need days/weeks.
function humanizeSeconds(s: number): string {
  if (s < 60) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// providerName: lowercase byoc slug -> display name ("e2b" -> "E2B", "daytona" -> "Daytona").
// ponytail: a 2-entry map; switch to a registry if more providers land.
const PROVIDER_LABELS: Record<string, string> = {
  e2b: "E2B",
  daytona: "Daytona",
};
function providerName(slug: string): string {
  if (PROVIDER_LABELS[slug]) return PROVIDER_LABELS[slug];
  // ponytail: fallback title-case; only reached for unknown slugs.
  return slug[0]?.toUpperCase() + slug.slice(1);
}

export function Settings({ onLogout }: { onLogout: () => void }) {
  const toast = useToast();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [provider, setProvider] = useState<ComputeProvider>("e2b");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [computeErr, setComputeErr] = useState<string | null>(null);

  const refresh = () =>
    api
      .getAccount()
      .then((a) => {
        setAccount(a);
        setErr(null);
      })
      .catch((e) => setErr(humanizeApiError(e).message))
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
  }, []);

  const saveCompute = async () => {
    setSaving(true);
    setComputeErr(null);
    try {
      await api.setCompute(provider, apiKey.trim());
      await refresh();
      toast.push("Compute configured", "success");
      setApiKey("");
    } catch (e) {
      setComputeErr(humanizeApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const removeCompute = async () => {
    // ponytail: window.confirm is the one data-loss guardrail that matters here —
    // DELETE clears the BYOC config. No custom modal; native confirm is enough.
    if (!window.confirm("Remove compute configuration?")) return;
    setComputeErr(null);
    try {
      await api.clearCompute();
      await refresh();
      toast.push("Compute removed", "success");
    } catch (e) {
      setComputeErr(humanizeApiError(e).message);
    }
  };

  const byoc = account?.compute.byoc_provider ?? null;
  const initials = account
    ? account.user.login.slice(0, 2).toUpperCase()
    : "";

  return (
    <div className="st-wrap">
      {/* ACCOUNT */}
      <section className="st-section">
        <div className="st-section-title">Account</div>
        {loading ? (
          <div className="st-note">Loading…</div>
        ) : err ? (
          <div className="st-error">{err}</div>
        ) : account ? (
          <div className="st-account-row">
            {account.user.avatar_url ? (
              <img
                src={account.user.avatar_url}
                className="st-avatar"
                alt=""
              />
            ) : (
              <div className="st-avatar st-avatar-fallback">{initials}</div>
            )}
            <span className="st-account-login">{account.user.login}</span>
            {account.user.github_connected ? (
              <span className="st-chip ok">GitHub connected</span>
            ) : (
              <span className="st-chip bad">
                GitHub not connected
                {" · "}
                <a href="/auth/github/login">Connect GitHub</a>
              </span>
            )}
          </div>
        ) : null}
      </section>

      {/* PLAN */}
      {account && (
        <section className="st-section">
          <div className="st-section-title">Plan</div>
          <div className="st-account-login">{account.plan.name}</div>
          <div className="st-note">Bring your own key + your own compute.</div>
          <div className="st-note">
            Paid hosted-compute plans are coming soon. Today Atelier is
            bring-your-own-key and bring-your-own-compute.
          </div>
        </section>
      )}

      {/* COMPUTE (BYOC) */}
      {account && (
        <section className="st-section">
          <div className="st-section-title">Compute</div>
          {byoc ? (
            <>
              <span className="st-chip ok">
                {providerName(byoc)} configured
              </span>
              <div>
                <Button variant="ghost" onClick={removeCompute}>
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="st-form">
                <Select
                  label="Compute provider"
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as ComputeProvider)
                  }
                >
                  <option value="e2b">E2B</option>
                  <option value="daytona">Daytona</option>
                </Select>
                <Input
                  label="API key"
                  type="password"
                  placeholder="paste your E2B/Daytona key"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {computeErr && <div className="st-error">{computeErr}</div>}
                <div className="st-form-actions">
                  <Button
                    variant="primary"
                    loading={saving}
                    disabled={!provider || !apiKey.trim() || saving}
                    onClick={saveCompute}
                  >
                    {saving ? "Saving…" : "Save compute"}
                  </Button>
                </div>
              </div>
              <div className="st-note">
                Your key is encrypted at rest and used only to provision your
                sandboxes.
              </div>
            </>
          )}
        </section>
      )}

      {/* USAGE */}
      {account && (
        <section className="st-section">
          <div className="st-section-title">Usage</div>
          <div className="st-stat-row">
            <div className="st-stat">
              <div className="st-stat-value">{account.usage.sessions}</div>
              <div className="st-stat-label">Workspaces</div>
            </div>
            <div className="st-stat">
              <div className="st-stat-value">
                {humanizeSeconds(account.usage.billed_seconds)}
              </div>
              <div className="st-stat-label">Compute time</div>
            </div>
          </div>
        </section>
      )}

      {/* SIGN OUT */}
      <section className="st-section">
        <Button variant="ghost" onClick={onLogout}>
          Sign out
        </Button>
      </section>
    </div>
  );
}
