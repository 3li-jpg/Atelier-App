import { useEffect, useState } from "react";
import { api, type Account, type Billing, type ComputeProvider } from "../api.ts";
import { Badge, Button, Input, Select, useToast } from "@atelier/ui";
import { humanizeApiError } from "./humanize.ts";
import "./settings.css";

// Real /account payloads can return `billing: null` on self-hosted / local dev
// servers with no Stripe wired up. api.ts types billing as non-null (a lie that
// crashes PlanSection), so narrow it here. We can only edit these two files,
// hence the local override rather than fixing api.ts. ponytail: local type
// narrowing — promote to api.ts as `billing: Billing | null` when allowed.
type AccountMaybeBilling = Omit<Account, "billing"> & { billing: Billing | null };

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
  const [account, setAccount] = useState<AccountMaybeBilling | null>(null);
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
        setAccount(a as AccountMaybeBilling);
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
        <header className="st-section-head">
          <h2 className="st-section-title">Account</h2>
          <p className="st-section-desc">Your identity and sign-in connection.</p>
        </header>
        {loading ? (
          <div className="st-note">Loading…</div>
        ) : err ? (
          <div className="st-error">{err}</div>
        ) : account ? (
          <div className="st-account-row">
            <div className="st-avatar-wrap">
              {account.user.avatar_url ? (
                <img
                  src={account.user.avatar_url}
                  className="st-avatar"
                  alt=""
                />
              ) : (
                <div className="st-avatar st-avatar-fallback">{initials}</div>
              )}
            </div>
            <div className="st-account-meta">
              <span className="st-account-login">{account.user.login}</span>
              {account.user.github_connected ? (
                <Badge tone="ok">GitHub connected</Badge>
              ) : (
                <Badge tone="idle">
                  GitHub not connected{" · "}
                  <a href="/auth/github/login">Connect</a>
                </Badge>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* PLAN */}
      {account && <PlanSection account={account} />}

      {/* COMPUTE (BYOC) */}
      {account && (
        <section className="st-section">
          <header className="st-section-head">
            <h2 className="st-section-title">Compute</h2>
            <p className="st-section-desc">
              Bring your own cloud — keys are encrypted at rest.
            </p>
          </header>
          {byoc ? (
            <div className="st-compute-active">
              <div className="st-row">
                <span className="st-row-label">Provider</span>
                <span className="st-row-value">
                  {providerName(byoc)}
                  <Badge tone="ok">configured</Badge>
                </span>
              </div>
              <div className="st-row-actions">
                <Button variant="ghost" onClick={removeCompute}>
                  Remove
                </Button>
              </div>
            </div>
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
          <header className="st-section-head">
            <h2 className="st-section-title">Usage</h2>
            <p className="st-section-desc">Workspaces and metered compute time.</p>
          </header>
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

      {/* PRIVACY & DATA */}
      {account && (
        <section className="st-section st-danger">
          <header className="st-section-head">
            <h2 className="st-section-title">Privacy & Data</h2>
            <p className="st-section-desc">Export your data or delete your account.</p>
          </header>
          <div className="st-row-actions">
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const blob = new Blob([JSON.stringify(await api.exportAccount(), null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "atelier-export.json";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  toast.push(humanizeApiError(e).message, "error");
                }
              }}
            >
              Export my data
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const typed = window.prompt(
                  `Type your email to confirm deletion: ${account.user.login}`,
                );
                if (typed === null) return;
                if (typed !== account.user.login) {
                  toast.push("Email did not match", "error");
                  return;
                }
                try {
                  await api.deleteAccount();
                  window.location.href = "/";
                } catch (e) {
                  toast.push(humanizeApiError(e).message, "error");
                }
              }}
            >
              Delete account
            </Button>
          </div>
        </section>
      )}

      {/* SIGN OUT */}
      <section className="st-section st-danger">
        <header className="st-section-head">
          <h2 className="st-section-title">Session</h2>
          <p className="st-section-desc">End your current session on this device.</p>
        </header>
        <div className="st-row-actions">
          <Button variant="ghost" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}

const STATUS_TONE: Record<Billing["status"], "ok" | "warn" | "bad" | "accent"> = {
  active: "ok",
  trialing: "accent",
  past_due: "warn",
  canceled: "bad",
};

const SANDBOX_TIERS: [string, string][] = [
  ["free", "Free"], ["plus", "Plus"], ["pro", "Pro"], ["max", "Max"],
];
const VPS_SIZES: [string, string][] = [
  ["small", "Small"], ["medium", "Medium"], ["large", "Large"],
];

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return null;
  }
}

function PlanSection({ account }: { account: AccountMaybeBilling }) {
  const toast = useToast();
  const billing = account.billing;
  // Hooks must run unconditionally — init from billing?.tier so the early
  // return for null billing doesn't break rules-of-hooks. ponytail: the
  // choice state simply goes unused on the null-billing path.
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(billing?.tier ?? "");

  // billing === null: self-hosted / local dev with no Stripe. Render a calm,
  // null-safe card and bail before touching any billing.* field.
  if (!billing) {
    return (
      <section className="st-section">
        <header className="st-section-head">
          <h2 className="st-section-title">Plan</h2>
          <p className="st-section-desc">Your current subscription tier.</p>
        </header>
        <div className="st-row">
          <span className="st-row-label">Plan</span>
          <span className="st-row-value">
            <Badge tone="accent">{account.plan.name}</Badge>
          </span>
        </div>
        <div className="st-note">Billing is not configured on this server.</div>
      </section>
    );
  }

  const onCheckout = async () => {
    if (!choice || choice === billing.tier) {
      toast.push("Choose a different plan first", "info");
      return;
    }
    setBusy(true);
    try {
      const res =
        billing.product === "sandbox"
          ? await api.checkout("sandbox", choice)
          : await api.checkout("vps", undefined, choice);
      window.location.href = res.url;
    } catch (e) {
      toast.push(humanizeApiError(e).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const onPortal = async () => {
    if (!billing.stripe_customer_id) return;
    setBusy(true);
    try {
      const res = await api.billingPortal(billing.stripe_customer_id);
      window.location.href = res.url;
    } catch (e) {
      toast.push(humanizeApiError(e).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="st-section">
      <header className="st-section-head">
        <h2 className="st-section-title">Plan</h2>
        <p className="st-section-desc">Your current subscription tier.</p>
      </header>
      <div className="st-row">
        <span className="st-row-label">Plan</span>
        <span className="st-row-value">
          {account.plan.name}
          <Badge tone={STATUS_TONE[billing.status]}>{billing.status}</Badge>
        </span>
      </div>
      <div className="st-row">
        <span className="st-row-label">Type</span>
        <span className="st-row-value">
          {billing.product === "vps" ? "Hosted VPS" : "Sandbox"} · {titleCase(billing.tier)}
          {billing.status === "trialing" && billing.trial_end && (
            <> · trial ends {formatDate(billing.trial_end)}</>
          )}
          {billing.current_period_end && billing.status !== "trialing" && (
            <> · renews {formatDate(billing.current_period_end)}</>
          )}
        </span>
      </div>
      {billing.product === "sandbox" && billing.included_hours != null && (
        <div className="st-row">
          <span className="st-row-label">Usage</span>
          <span className="st-row-value">
            {billing.usage_hours.toFixed(1)} / {billing.included_hours} hours
          </span>
        </div>
      )}

      <div className="st-plan-actions">
        {billing.product === "sandbox" ? (
          <Select
            label="Choose tier"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {SANDBOX_TIERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            label="Choose size"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {VPS_SIZES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        )}
        <Button variant="primary" onClick={onCheckout} loading={busy} disabled={busy}>
          Upgrade
        </Button>
      </div>

      {billing.stripe_customer_id && (
        <div className="st-plan-manage">
          <Button variant="ghost" onClick={onPortal} loading={busy} disabled={busy}>
            Manage billing
          </Button>
        </div>
      )}
    </section>
  );
}
