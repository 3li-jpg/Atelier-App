import { useEffect, useState } from "react";
import { api, type ProviderSummary, type ProviderCreate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";

// T7.4: Providers screen — list, add, and validate (FR-1.3: cheap completion +
// tool-call round-trip; shows latency + tool-call fidelity).
export function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.listProviders().then(setProviders).catch((e) => { setProviders([]); setErr(String(e)); });
  };
  useEffect(load, []);

  return (
    <>
      <AddProvider onSaved={load} />
      {err && <div className="error padded">{err}</div>}
      {providers === null ? (
        <p className="muted padded">loading…</p>
      ) : providers.length === 0 ? (
        <p className="muted padded">no providers yet</p>
      ) : (
        <ul className="session-list padded">
          {providers.map((p) => (
            <li key={p.id} className="provider-card">
              <div className="row-top">
                <strong>{p.name}</strong>
                <span className="muted small">{p.dialect}</span>
              </div>
              <div className="muted small">{p.base_url}</div>
              <div className="muted small">models: {p.models.map((m) => m.id).join(", ")}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AddProvider({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "", base_url: "", dialect: "openai-chat", model_id: "", api_key: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const build = (): ProviderCreate => ({
    name: form.name.trim(),
    base_url: form.base_url.trim(),
    dialect: form.dialect as ProviderCreate["dialect"],
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

  const validate = () => run(async () => setResult(await api.validateProvider(build())));
  const save = () => run(async () => {
    await api.createProvider(build());
    setForm({ name: "", base_url: "", dialect: "openai-chat", model_id: "", api_key: "" });
    onSaved();
  });

  return (
    <div className="form padded">
      <label>Name
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My OpenRouter" />
        {errors.name && <span className="field-err">{errors.name}</span>}
      </label>
      <label>Base URL
        <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
        {errors.base_url && <span className="field-err">{errors.base_url}</span>}
      </label>
      <label>Dialect
        <select value={form.dialect} onChange={(e) => setForm({ ...form, dialect: e.target.value })}>
          {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label>Model ID
        <input value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })} placeholder="anthropic/claude-3.5-sonnet" />
        {errors.model_id && <span className="field-err">{errors.model_id}</span>}
      </label>
      <label>API key
        <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-…" />
        {errors.api_key && <span className="field-err">{errors.api_key}</span>}
      </label>
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
        <button onClick={validate} disabled={busy}>Validate</button>
        <button className="primary" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
      </div>
    </div>
  );
}
