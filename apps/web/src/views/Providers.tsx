import "./providers.css";
import { useEffect, useState } from "react";
import { api, type ProviderSummary, type ProviderCreate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";
import { Input, Select, Button, Card, Badge, Skeleton, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { PROVIDER_PRESETS } from "../onboarding/presets.ts";
import { humanizeApiError, humanizeToast } from "./humanize.ts";

type ModelEntry = { id: string; role: "coder" | "utility" };

// T7.4: Providers screen — list, add, and validate (FR-1.3: cheap completion +
// tool-call round-trip; shows latency + tool-call fidelity).
// Supports multiple models per provider — add/remove model rows.
export function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const load = () => {
    setErr(null);
    api.listProviders().then(setProviders).catch((e) => {
      setProviders([]);
      setErr(humanizeApiError(e).message);
    });
  };
  useEffect(load, [retryCount]);

  const retry = () => setRetryCount((n) => n + 1);

  return (
    <div className="pv-shell">
      <AddProvider onSaved={load} />
      {err ? (
        <StateMessage
          kind="error"
          title="Couldn't load providers"
          description={err}
          action={<Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
        />
      ) : providers === null ? (
        <div className="pv-skeletons">
          <Skeleton height="4rem" radius="var(--radius)" />
          <Skeleton height="4rem" radius="var(--radius)" />
        </div>
      ) : providers.length === 0 ? (
        <StateMessage kind="empty" title="No providers configured" />
      ) : (
        <ul className="pv-list">
          {providers.map((p) => (
            <li key={p.id}>
              <Card className="pv-card">
                <div className="pv-row-top">
                  <strong>{p.name}</strong>
                  <Badge tone="accent">{p.dialect}</Badge>
                </div>
                <div className="pv-base-url">{p.base_url}</div>
                <div className="pv-models">
                  {p.models.map((m) => (
                    <Badge
                      key={m.id}
                      tone={m.role === "coder" ? "accent" : "idle"}
                      className="pv-model-chip"
                    >
                      {m.id}
                    </Badge>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddProvider({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  // Apply the default preset on first render so Name/Base URL/Models are
  // pre-filled (not blank) when the card shows as selected.
  const initial = (() => {
    const p = PROVIDER_PRESETS.find((x) => x.id === "umans") ?? PROVIDER_PRESETS[0];
    const b = p.build("");
    return {
      presetId: p.id,
      name: b.name,
      baseUrl: b.base_url,
      dialect: b.dialect,
      models: b.models.map((m) => ({ id: m.id, role: m.role as "coder" | "utility" })),
    };
  })();
  const [presetId, setPresetId] = useState<string>(initial.presetId);
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [dialect, setDialect] = useState<string>(initial.dialect);
  const [models, setModels] = useState<ModelEntry[]>(initial.models);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [failText, setFailText] = useState<string | null>(null);

  const isCustom = presetId === "custom";

  const applyPreset = (id: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    const built = preset.build("");
    setName(built.name);
    setBaseUrl(built.base_url);
    setDialect(built.dialect);
    setModels(built.models.map((m) => ({ id: m.id, role: m.role as "coder" | "utility" })));
    setErrors({});
    setResult(null);
    setFailText(null);
  };

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

  const run = async (fn: () => Promise<unknown>, onError: (e: unknown) => void) => {
    const formForValidation = {
      name, base_url: baseUrl, dialect, model_id: firstModel?.id ?? "", api_key: apiKey,
    };
    const e = validateProviderForm(formForValidation);
    if (models.filter((m) => m.id.trim()).length === 0) {
      e.model_id = "at least one model required";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true); setResult(null); setFailText(null);
    try { await fn(); }
    catch (e2) {
      onError(e2);
    }
    finally { setBusy(false); }
  };

  const validate = () => run(async () => {
    const res = await api.validateProvider(build());
    setResult(res);
    if (res.ok) {
      toast.push("Key works", "success");
    } else {
      // Failure-text rule: cap result.error to 120 chars; fallback message when empty.
      const raw = typeof res.error === "string" && res.error.length > 0 ? res.error : "";
      setFailText(raw ? raw.slice(0, 120) : "Key unusable — check the key and base URL.");
    }
  }, (e2) => toast.push(humanizeToast(e2), "error"));
  const save = () => run(async () => {
    await api.createProvider(build());
    // Reset to the default preset so the form is ready for another add.
    const p = PROVIDER_PRESETS.find((x) => x.id === "umans") ?? PROVIDER_PRESETS[0];
    const b = p.build("");
    setPresetId(p.id);
    setName(b.name);
    setBaseUrl(b.base_url);
    setDialect(b.dialect);
    setModels(b.models.map((m) => ({ id: m.id, role: m.role as "coder" | "utility" })));
    setApiKey("");
    setErrors({}); setResult(null); setFailText(null);
    toast.push("Provider saved", "success");
    onSaved();
  }, (e2) => toast.push(humanizeToast(e2), "error"));

  return (
    <Card className="pv-add-card">
      <div className="pv-preset-grid" role="radiogroup" aria-label="Provider preset">
        {PROVIDER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={presetId === p.id}
            className={`pv-preset-card${presetId === p.id ? " selected" : ""}`}
            onClick={() => applyPreset(p.id)}
          >
            <span className="pv-preset-label">{p.label}</span>
            <span className="pv-preset-desc">{p.description}</span>
          </button>
        ))}
      </div>

      {isCustom ? (
        <>
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
            error={errors.dialect}
          >
            {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </>
      ) : (
        <>
          <Input label="Name" value={name} readOnly onChange={() => {}} />
          <Input label="Base URL" value={baseUrl} readOnly onChange={() => {}} />
          <Select label="Dialect" value={dialect} onChange={() => {}}>
            {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <div className="pv-locked-hint">Preset fields are fixed. Models and API key are editable.</div>
        </>
      )}

      {/* Multiple models */}
      <div className="pv-models-section">
        <div className="pv-models-header">
          <span className="atelier-input-label">Models</span>
          <Button variant="ghost" size="sm" onClick={addModel}>+ Add model</Button>
        </div>
        {errors.model_id && <span className="atelier-input-error">{errors.model_id}</span>}
        {models.map((m, idx) => (
          <div key={idx} className="pv-model-row">
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

      {result && (
        <div className={`pv-result ${result.ok ? "ok" : "bad"}`}>
          {result.ok ? (
            <>
              <div>✓ Key works</div>
              <div className="pv-result-meta muted small">
                latency {result.latency_ms}ms · completion {result.completion ? "ok" : "fail"} · tool calls {result.tool_calls ? "ok" : "fail"}
              </div>
            </>
          ) : (
            <div className="pv-result-fail">{failText}</div>
          )}
        </div>
      )}

      <div className="form-actions">
        <Button onClick={validate} disabled={busy} loading={busy && !result}>Test key</Button>
        <Button variant="primary" onClick={save} disabled={busy} loading={busy}>{busy ? "…" : "Save"}</Button>
      </div>
    </Card>
  );
}
