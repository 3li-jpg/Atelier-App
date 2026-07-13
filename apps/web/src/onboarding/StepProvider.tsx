import { useState } from "react";
import { motion } from "framer-motion";
import { api, type ProviderCreate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";
import { PROVIDER_PRESETS, type ProviderPreset } from "./presets.ts";
import { hoverLift, tapScale } from "../motion.ts";
import { humanizeApiError } from "../views/humanize.ts";

type ModelEntry = { id: string; role: "coder" | "utility" };

// Step 2: BYOK. User picks a preset (or custom), fills in API key, and can
// test the key before saving. Supports multiple models per provider —
// add/remove model rows, each with an ID + role (coder/utility).
export function StepProvider({ onDone, onBack }: {
  onDone: (providerId: string) => void;
  onBack: () => void;
}) {
  const [presetId, setPresetId] = useState<string>("umans");
  const [name, setName] = useState("Umans");
  const [baseUrl, setBaseUrl] = useState("https://api.code.umans.ai/v1");
  const [dialect, setDialect] = useState<ProviderCreate["dialect"]>("openai-chat");
  const [models, setModels] = useState<ModelEntry[]>([
    { id: "umans-glm-5.2", role: "coder" },
    { id: "umans-kimi-k2.7", role: "coder" },
    { id: "umans-coder", role: "coder" },
    { id: "umans-flash", role: "utility" },
  ]);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const selectPreset = (p: ProviderPreset) => {
    setPresetId(p.id);
    const tpl = p.build("");
    setName(tpl.name);
    setBaseUrl(tpl.base_url);
    setDialect(tpl.dialect);
    setModels(tpl.models.map((m) => ({ id: m.id, role: m.role as "coder" | "utility" })));
    setErrors({});
    setResult(null);
    setErr(null);
  };

  const updateModel = (idx: number, field: keyof ModelEntry, val: string) => {
    setModels((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };
  const addModel = () => setModels((prev) => [...prev, { id: "", role: "coder" }]);
  const removeModel = (idx: number) => setModels((prev) => prev.filter((_, i) => i !== idx));

  const build = (): ProviderCreate => ({
    name: name.trim(),
    base_url: baseUrl.trim(),
    dialect,
    models: models.filter((m) => m.id.trim()).map((m) => ({
      id: m.id.trim(), role: m.role, tool_calls: true,
    })),
    api_key: apiKey.trim(),
  });

  // For validation, use the first coder model
  const firstModel = models.find((m) => m.id.trim()) ?? models[0];

  const run = async (fn: () => Promise<unknown>) => {
    const formForValidation = {
      name, base_url: baseUrl, dialect, model_id: firstModel?.id ?? "", api_key: apiKey,
    };
    const e = validateProviderForm(formForValidation);
    // Also check all models have IDs
    if (models.filter((m) => m.id.trim()).length === 0) {
      e.model_id = "at least one model required";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true); setErr(null); setResult(null);
    try { await fn(); }
    catch (e2) { setErr(humanizeApiError(e2).message); }
    finally { setBusy(false); }
  };

  const testKey = () => run(async () => setResult(await api.validateProvider(build())));
  const save = () => run(async () => {
    const res = await api.createProvider(build());
    onDone(res.id);
  });

  const isCustom = presetId === "custom";

  return (
    <div className="onb-step">
      <h2 className="onb-step-title">Connect your model</h2>
      <p className="onb-step-sub">Bring your own key. Pick a provider preset, or choose Custom.</p>

      {/* Preset cards */}
      <div className="onb-preset-grid" role="radiogroup" aria-label="Provider preset">
        {PROVIDER_PRESETS.map((p) => (
          <motion.button
            key={p.id}
            className={`onb-preset-card ${presetId === p.id ? "selected" : ""}`}
            onClick={() => selectPreset(p)}
            role="radio"
            aria-checked={presetId === p.id}
            aria-label={`${p.label} — ${p.description}`}
            variants={hoverLift}
            initial="rest"
            whileHover="hover"
            whileTap="hover"
          >
            <span className="preset-label">{p.label}</span>
            <span className="preset-desc">{p.description}</span>
          </motion.button>
        ))}
      </div>

      {/* Form fields */}
      <div className="form">
        {isCustom && (
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Provider" />
            {errors.name && <span className="field-err">{errors.name}</span>}
          </label>
        )}
        {isCustom && (
          <label>Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
            {errors.base_url && <span className="field-err">{errors.base_url}</span>}
          </label>
        )}
        {isCustom && (
          <label>Dialect
            <select value={dialect} onChange={(e) => setDialect(e.target.value as ProviderCreate["dialect"])}>
              {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}

        {/* Multiple models */}
        <div className="onb-models-section">
          <div className="onb-models-header">
            <span>Models</span>
            <motion.button type="button" className="ghost small" onClick={addModel}
              variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
            >+ Add model</motion.button>
          </div>
          {errors.model_id && <span className="field-err">{errors.model_id}</span>}
          {models.map((m, idx) => (
            <div key={idx} className="onb-model-row">
              <input
                value={m.id}
                onChange={(e) => updateModel(idx, "id", e.target.value)}
                placeholder="model-id (e.g. umans-glm-5.2)"
              />
              <select
                value={m.role}
                onChange={(e) => updateModel(idx, "role", e.target.value)}
              >
                <option value="coder">coder</option>
                <option value="utility">utility</option>
              </select>
              {models.length > 1 && (
                <motion.button type="button" className="ghost small onb-model-remove"
                  onClick={() => removeModel(idx)}
                  variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
                  title="Remove model"
                >✕</motion.button>
              )}
            </div>
          ))}
        </div>

        <label>API Key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
          />
          {errors.api_key && <span className="field-err">{errors.api_key}</span>}
        </label>
      </div>

      {err && <div className="error">{err}</div>}

      {result && (
        <div className={`onb-validate-result ${result.ok ? "ok" : "bad"}`}>
          <div>{result.ok ? "✓ Key works — ready for agentic coding" : "✗ Key unusable"}</div>
          <div className="muted small">
            latency {result.latency_ms}ms · completion {result.completion ? "ok" : "fail"} · tool calls {result.tool_calls ? "ok" : "fail"}
          </div>
          {result.error && <div className="muted small">{result.error}</div>}
        </div>
      )}

      <div className="onb-nav">
        <motion.button className="ghost" onClick={onBack}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >← Back</motion.button>
        <motion.button onClick={testKey} disabled={busy}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >Test key</motion.button>
        <motion.button className="primary" onClick={save} disabled={busy}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >
          {busy ? "…" : "Save & continue"}
        </motion.button>
      </div>

      <style>{`
        .onb-models-section { display: flex; flex-direction: column; gap: 0.4rem; }
        .onb-models-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--muted); }
        .onb-model-row { display: flex; gap: 0.4rem; align-items: center; }
        .onb-model-row input { flex: 1; }
        .onb-model-row select { width: auto; min-width: 5rem; }
        .onb-model-remove { padding: 0.3rem 0.5rem; color: var(--bad); }
      `}</style>
    </div>
  );
}
