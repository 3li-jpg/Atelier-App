import { useEffect, useState } from "react";
import { api, type ProviderSummary, type ProviderCreate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";
import { Input, Select, Button, Card, Badge, Skeleton, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";

type ModelEntry = { id: string; role: "coder" | "utility" };

// T7.4: Providers screen — list, add, and validate (FR-1.3: cheap completion +
// tool-call round-trip; shows latency + tool-call fidelity).
// Supports multiple models per provider — add/remove model rows.
export function Providers() {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const load = () => {
    setErr(null);
    api.listProviders().then(setProviders).catch((e) => {
      setProviders([]);
      const msg = String(e).replace(/^Error:\s*/, "");
      setErr(msg);
      toast.push("Failed to load providers", "error");
    });
  };
  useEffect(load, [retryCount]);

  const retry = () => setRetryCount((n) => n + 1);

  return (
    <>
      <AddProvider onSaved={load} />
      {err ? (
        <StateMessage
          kind="error"
          title="Couldn't load providers"
          description={err}
          action={<Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
        />
      ) : providers === null ? (
        <div className="padded" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Skeleton height="4rem" radius="var(--radius)" />
          <Skeleton height="4rem" radius="var(--radius)" />
        </div>
      ) : providers.length === 0 ? (
        <StateMessage
          kind="empty"
          title="No providers configured"
          description="Add your first model provider above to start running agentic coding sessions."
        />
      ) : (
        <ul className="session-list padded">
          {providers.map((p) => (
            <li key={p.id}>
              <Card className="provider-card">
                <div className="row-top">
                  <strong>{p.name}</strong>
                  <Badge tone="accent">{p.dialect}</Badge>
                </div>
                <div className="muted small">{p.base_url}</div>
                <div className="provider-models">
                  {p.models.map((m) => (
                    <Badge key={m.id} tone={m.role === "coder" ? "accent" : "idle"}>{m.id}</Badge>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .provider-models { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.3rem; }
      `}</style>
    </>
  );
}

function AddProvider({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [dialect, setDialect] = useState("openai-chat");
  const [models, setModels] = useState<ModelEntry[]>([{ id: "", role: "coder" }]);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const updateModel = (idx: number, field: keyof ModelEntry, val: string) => {
    setModels((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };
  const addModel = () => setModels((prev) => [...prev, { id: "", role: "coder" }]);
  const removeModel = (idx: number) => setModels((prev) => prev.filter((_, i) => i !== idx));

  const firstModel = models.find((m) => m.id.trim()) ?? models[0];

  const build = (): ProviderCreate => ({
    name: name.trim(),
    base_url: baseUrl.trim(),
    dialect: dialect as ProviderCreate["dialect"],
    models: models.filter((m) => m.id.trim()).map((m) => ({
      id: m.id.trim(), role: m.role, tool_calls: true,
    })),
    api_key: apiKey.trim(),
  });

  const run = async (fn: () => Promise<unknown>) => {
    const formForValidation = {
      name, base_url: baseUrl, dialect, model_id: firstModel?.id ?? "", api_key: apiKey,
    };
    const e = validateProviderForm(formForValidation);
    if (models.filter((m) => m.id.trim()).length === 0) {
      e.model_id = "at least one model required";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true); setErr(null); setResult(null);
    try { await fn(); }
    catch (e2) {
      const msg = String(e2);
      setErr(msg);
      toast.push("Provider operation failed", "error");
    }
    finally { setBusy(false); }
  };

  const validate = () => run(async () => {
    const res = await api.validateProvider(build());
    setResult(res);
    toast.push(res.ok ? "Provider validated ✓" : "Provider unusable", res.ok ? "success" : "error");
  });
  const save = () => run(async () => {
    await api.createProvider(build());
    setName(""); setBaseUrl(""); setDialect("openai-chat");
    setModels([{ id: "", role: "coder" }]); setApiKey("");
    toast.push("Provider saved", "success");
    onSaved();
  });

  return (
    <Card className="padded" style={{ border: "none", background: "transparent", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My OpenRouter"
        error={errors.name}
      />
      <Input
        label="Base URL"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://openrouter.ai/api/v1"
        error={errors.base_url}
      />
      <Select
        label="Dialect"
        value={dialect}
        onChange={(e) => setDialect(e.target.value)}
      >
        {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
      </Select>

      {/* Multiple models */}
      <div className="provider-models-section">
        <div className="provider-models-header">
          <span className="atelier-input-label">Models</span>
          <Button variant="ghost" size="sm" onClick={addModel}>+ Add model</Button>
        </div>
        {errors.model_id && <span className="atelier-input-error">{errors.model_id}</span>}
        {models.map((m, idx) => (
          <div key={idx} className="provider-model-row">
            <input
              className="atelier-input"
              value={m.id}
              onChange={(e) => updateModel(idx, "id", e.target.value)}
              placeholder="model-id (e.g. umans-glm-5.2)"
            />
            <select
              className="atelier-input atelier-select"
              value={m.role}
              onChange={(e) => updateModel(idx, "role", e.target.value)}
            >
              <option value="coder">coder</option>
              <option value="utility">utility</option>
            </select>
            {models.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeModel(idx)} title="Remove model">✕</Button>
            )}
          </div>
        ))}
      </div>

      <Input
        label="API key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-…"
        error={errors.api_key}
      />
      {err && <div className="error">{err}</div>}
      {result && (
        <div className={`validate-result ${result.ok ? "ok" : "bad"}`}>
          <div>{result.ok ? "✓ usable for agentic coding" : "✗ unusable"}</div>
          <div className="muted small">
            latency {result.latency_ms}ms · completion {result.completion ? "ok" : "fail"} · tool calls {result.tool_calls ? "ok" : "fail"}
          </div>
          {result.error && <div className="muted small">{result.error}</div>}
        </div>
      )}
      <div className="form-actions">
        <Button onClick={validate} disabled={busy} loading={busy && !result}>Validate</Button>
        <Button variant="primary" onClick={save} disabled={busy} loading={busy}>{busy ? "…" : "Save"}</Button>
      </div>

      <style>{`
        .provider-models-section { display: flex; flex-direction: column; gap: 0.4rem; }
        .provider-models-header { display: flex; justify-content: space-between; align-items: center; }
        .provider-model-row { display: flex; gap: 0.4rem; align-items: center; }
        .provider-model-row input { flex: 1; }
        .provider-model-row select { width: auto; min-width: 5rem; }
      `}</style>
    </Card>
  );
}
