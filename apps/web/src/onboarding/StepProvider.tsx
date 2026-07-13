import { useState } from "react";
import { motion } from "framer-motion";
import { api, type ProviderCreate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";
import { PROVIDER_PRESETS, type ProviderPreset } from "./presets.ts";
import { hoverLift, tapScale } from "../motion.ts";

// Step 2: BYOK. User picks a preset (or custom), fills in API key, and can
// test the key before saving. Mirrors the AddProvider form in Providers.tsx
// but with preset cards for faster setup.
export function StepProvider({ onDone, onBack }: {
  onDone: (providerId: string) => void;
  onBack: () => void;
}) {
  const [presetId, setPresetId] = useState<string>("umans");
  const [form, setForm] = useState({
    name: "Umans",
    base_url: "https://api.code.umans.ai",
    dialect: "openai-chat" as ProviderCreate["dialect"],
    model_id: "umans-coder",
    api_key: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const selectPreset = (p: ProviderPreset) => {
    setPresetId(p.id);
    // Build a template from the preset (with empty key) to pre-fill fields.
    const tpl = p.build("");
    setForm({
      name: tpl.name,
      base_url: tpl.base_url,
      dialect: tpl.dialect,
      model_id: tpl.models[0]?.id ?? "",
      api_key: form.api_key, // preserve any key the user already typed
    });
    setErrors({});
    setResult(null);
    setErr(null);
  };

  const build = (): ProviderCreate => ({
    name: form.name.trim(),
    base_url: form.base_url.trim(),
    dialect: form.dialect,
    models: [{ id: form.model_id.trim(), role: "coder", tool_calls: true }],
    api_key: form.api_key.trim(),
  });

  const run = async (fn: () => Promise<unknown>) => {
    const e = validateProviderForm(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true); setErr(null); setResult(null);
    try { await fn(); }
    catch (e2) { setErr(String(e2)); }
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
      <div className="onb-preset-grid">
        {PROVIDER_PRESETS.map((p) => (
          <motion.button
            key={p.id}
            className={`onb-preset-card ${presetId === p.id ? "selected" : ""}`}
            onClick={() => selectPreset(p)}
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
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Provider"
            />
            {errors.name && <span className="field-err">{errors.name}</span>}
          </label>
        )}
        {isCustom && (
          <label>Base URL
            <input
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
            {errors.base_url && <span className="field-err">{errors.base_url}</span>}
          </label>
        )}
        {isCustom && (
          <label>Dialect
            <select value={form.dialect} onChange={(e) => setForm({ ...form, dialect: e.target.value as ProviderCreate["dialect"] })}>
              {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
        {isCustom && (
          <label>Model ID
            <input
              value={form.model_id}
              onChange={(e) => setForm({ ...form, model_id: e.target.value })}
              placeholder="model-name"
            />
            {errors.model_id && <span className="field-err">{errors.model_id}</span>}
          </label>
        )}
        <label>API Key
          <input
            type="password"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
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
    </div>
  );
}
