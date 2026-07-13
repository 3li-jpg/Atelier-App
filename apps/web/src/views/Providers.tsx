import "./providers.css";
import { useEffect, useRef, useState } from "react";
import { api, type ProviderSummary, type ProviderCreate, type ProviderUpdate, type ValidationResult } from "../api.ts";
import { DIALECTS, validateProviderForm, type FieldErrors } from "../lib.ts";
import { Input, Select, Button, Card, Badge, Skeleton, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { PROVIDER_PRESETS } from "../onboarding/presets.ts";
import { humanizeApiError, humanizeToast } from "./humanize.ts";

type Role = "coder" | "utility";
type ModelRow = { id: string; role: Role; tool_calls: boolean };
type HeaderRow = { key: string; value: string };

// Show "start…end" for long URLs so the host + path tail stay readable.
function truncateMiddle(s: string, max = 40): string {
  if (s.length <= max) return s;
  const keep = max - 1; // 1 char for ellipsis
  const head = Math.ceil(keep * 0.62);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

// Full provider lifecycle: glass card list, one editor for Add + Edit,
// inline delete morph, inline test gated on a real key. ponytail: a single
// ProviderEditor serves both modes — if Add/Edit diverge further, split then.
export function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.listProviders().then(setProviders).catch((e) => {
      setProviders([]);
      setErr(humanizeApiError(e).message);
    });
  };
  useEffect(load, [retryCount]);

  const retry = () => setRetryCount((n) => n + 1);

  const onSaved = () => { setEditingId(null); load(); };

  return (
    <div className="pv-shell">
      {err ? (
        <StateMessage
          kind="error"
          title="Couldn't load providers"
          description={err}
          action={<Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
        />
      ) : providers === null ? (
        <div className="pv-skeletons">
          <Skeleton height="4.5rem" radius="var(--radius-lg)" />
          <Skeleton height="4.5rem" radius="var(--radius-lg)" />
        </div>
      ) : providers.length === 0 ? (
        // Empty: hero + preset grid feed straight into the Add editor.
        <EmptyHero onSaved={onSaved} />
      ) : (
        <>
          <ProviderEditor mode="add" onSaved={onSaved} />
          <ul className="pv-list">
            {providers.map((p) => (
              <li key={p.id}>
                {editingId === p.id ? (
                  <ProviderEditor mode="edit" provider={p} onSaved={onSaved} onCancel={() => setEditingId(null)} />
                ) : (
                  <ProviderCard
                    provider={p}
                    onEdit={() => setEditingId(p.id)}
                    onDeleted={load}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProviderCard({
  provider: p, onEdit, onDeleted,
}: {
  provider: ProviderSummary;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => () => clearTimer(), []);

  const askDelete = () => {
    setConfirming(true);
    clearTimer();
    timer.current = setTimeout(() => setConfirming(false), 5000);
  };
  const cancelDelete = () => { setConfirming(false); clearTimer(); };

  const confirmDelete = async () => {
    clearTimer();
    setDeleting(true);
    try {
      await api.deleteProvider(p.id);
      toast.push("Provider removed", "success");
      onDeleted();
    } catch (e) {
      toast.push(humanizeToast(e), "error");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="pv-card">
      <div className="pv-row-top">
        <strong>{p.name}</strong>
        <Badge tone="accent">{p.dialect}</Badge>
      </div>
      <div className="pv-base-url" title={p.base_url}>{truncateMiddle(p.base_url)}</div>
      <div className="pv-models">
        {p.models.map((m) => (
          <Badge key={m.id} tone="default" className="pv-model-chip">
            <span className="pv-model-id">{m.id}</span>
            <Badge tone={m.role === "coder" ? "accent" : "idle"} className="pv-model-role">{m.role}</Badge>
            <span
              className={`pv-tool-dot${m.tool_calls === false ? " off" : ""}`}
              title={m.tool_calls === false ? "tools off" : "tools on"}
              aria-label={m.tool_calls === false ? "tools off" : "tools on"}
            />
          </Badge>
        ))}
      </div>
      <div className="pv-card-actions">
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
        <Button variant="ghost" size="sm" onClick={onEdit} title="Testing needs the key — opens Edit">
          Test
        </Button>
        {confirming ? (
          <span className="pv-delete-prompt">
            Delete provider?
            <Button variant="danger" size="sm" onClick={confirmDelete} disabled={deleting} loading={deleting}>Confirm</Button>
            <Button variant="ghost" size="sm" onClick={cancelDelete}>Keep</Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={askDelete}>Delete</Button>
        )}
      </div>
    </Card>
  );
}

// ONE editor for Add and Edit. mode + provider decide behavior; everything
// else is shared form state.
function ProviderEditor({
  mode, provider, onSaved, onCancel,
}: {
  mode: "add" | "edit";
  provider?: ProviderSummary;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const isEdit = mode === "edit";

  const initial = (() => {
    if (isEdit && provider) {
      return {
        presetId: "custom",
        name: provider.name,
        baseUrl: provider.base_url,
        dialect: provider.dialect,
        models: provider.models.map((m) => ({
          id: m.id,
          role: (m.role === "utility" ? "utility" : "coder") as Role,
          tool_calls: m.tool_calls !== false,
        })),
        headers: [] as HeaderRow[],
        apiKey: "",
      };
    }
    const p = PROVIDER_PRESETS.find((x) => x.id === "umans") ?? PROVIDER_PRESETS[0];
    const b = p.build("");
    return {
      presetId: p.id,
      name: b.name,
      baseUrl: b.base_url,
      dialect: b.dialect,
      models: b.models.map((m) => ({ id: m.id, role: m.role as Role, tool_calls: m.tool_calls !== false })),
      headers: [] as HeaderRow[],
      apiKey: "",
    };
  })();

  const [presetId, setPresetId] = useState(initial.presetId);
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [dialect, setDialect] = useState<string>(initial.dialect);
  const [models, setModels] = useState<ModelRow[]>(initial.models);
  const [headers, setHeaders] = useState<HeaderRow[]>(initial.headers);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [failText, setFailText] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  const applyPreset = (id: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    const b = preset.build("");
    setName(b.name);
    setBaseUrl(b.base_url);
    setDialect(b.dialect);
    setModels(b.models.map((m) => ({ id: m.id, role: m.role as Role, tool_calls: m.tool_calls !== false })));
    setErrors({}); setResult(null); setFailText(null);
  };

  const updateModel = (idx: number, patch: Partial<ModelRow>) =>
    setModels((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  const addModel = () => setModels((prev) => [...prev, { id: "", role: "coder", tool_calls: true }]);
  const removeModel = (idx: number) => setModels((prev) => prev.filter((_, i) => i !== idx));

  const updateHeader = (idx: number, patch: Partial<HeaderRow>) =>
    setHeaders((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  const addHeader = () => setHeaders((prev) => [...prev, { key: "", value: "" }]);
  const removeHeader = (idx: number) => setHeaders((prev) => prev.filter((_, i) => i !== idx));

  const keyEmpty = !apiKey.trim();

  const firstModel = models.find((m) => m.id.trim()) ?? models[0];

  const cleanModels = () =>
    models.filter((m) => m.id.trim()).map((m) => ({ id: m.id.trim(), role: m.role, tool_calls: m.tool_calls }));

  const headerObj = (): Record<string, string> | undefined => {
    const obj: Record<string, string> = {};
    for (const h of headers) {
      const k = h.key.trim();
      if (k) obj[k] = h.value;
    }
    // ponytail: omit when empty so EDIT never wipes stored headers
    // (listProviders doesn't return them, so we can't show existing).
    return Object.keys(obj).length > 0 ? obj : undefined;
  };

  const build = (): ProviderCreate => {
    const cfg: ProviderCreate = {
      name: name.trim(),
      base_url: baseUrl.trim(),
      dialect: dialect as ProviderCreate["dialect"],
      models: cleanModels(),
      api_key: apiKey.trim(),
    };
    const h = headerObj();
    if (h) cfg.headers = h;
    return cfg;
  };

  const validateFields = (): { form: FieldErrors; modelCount: number } => {
    const form = validateProviderForm({
      name, base_url: baseUrl, dialect,
      model_id: firstModel?.id ?? "", api_key: apiKey,
    });
    // In edit mode an empty key is legal (leave stored key untouched) — but
    // Test still requires one. For Save, drop the api_key error in edit mode.
    if (isEdit && form.api_key === "required") delete form.api_key;
    const modelCount = models.filter((m) => m.id.trim()).length;
    if (modelCount === 0) form.model_id = "at least one model required";
    return { form, modelCount };
  };

  const test = async () => {
    const { form } = validateFields();
    // Test always needs a real key (server uses it).
    if (keyEmpty) form.api_key = "enter the key to test";
    setErrors(form);
    if (Object.keys(form).length > 0) return;
    setBusy(true); setResult(null); setFailText(null);
    try {
      const res = await api.validateProvider(build());
      setResult(res);
      if (!res.ok) {
        const raw = typeof res.error === "string" && res.error.length > 0 ? res.error : "";
        setFailText(raw ? raw.slice(0, 120) : "Key unusable — check the key and base URL.");
      }
    } catch (e) {
      toast.push(humanizeToast(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const { form } = validateFields();
    setErrors(form);
    if (Object.keys(form).length > 0) return;
    setBusy(true);
    try {
      if (isEdit && provider) {
        const patch: ProviderUpdate = {
          name: name.trim(),
          base_url: baseUrl.trim(),
          dialect: dialect as ProviderUpdate["dialect"],
          models: cleanModels(),
        };
        if (!keyEmpty) patch.api_key = apiKey.trim();
        const h = headerObj();
        if (h) patch.headers = h;
        await api.updateProvider(provider.id, patch);
        toast.push("Provider updated", "success");
      } else {
        await api.createProvider(build());
        toast.push("Provider saved", "success");
      }
      onSaved();
    } catch (e) {
      toast.push(humanizeToast(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => { onCancel?.(); };

  // Escape cancels edit / resets add to the default preset.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const title = isEdit ? "Edit provider" : "Add a provider";

  return (
    <div className={`pv-editor${isEdit ? " in-card" : ""}`} onKeyDown={onKeyDown}>
      <div className="pv-editor-title">{title}</div>

      {!isEdit && (
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
      )}

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

      {/* Headers editor — empty by default; omitted from PATCH when no rows. */}
      <div>
        <div className="pv-section-head">
          <span className="pv-section-label">Headers</span>
          <Button variant="ghost" size="sm" onClick={addHeader}>+ Add header</Button>
        </div>
        <div className="pv-rows">
          {headers.map((h, idx) => (
            <div key={idx} className="pv-row">
              <input
                className="atelier-input"
                value={h.key}
                onChange={(e) => updateHeader(idx, { key: e.target.value })}
                placeholder="Header name"
                aria-label="Header name"
              />
              <input
                className="atelier-input"
                value={h.value}
                onChange={(e) => updateHeader(idx, { value: e.target.value })}
                placeholder="value"
                aria-label="Header value"
              />
              <Button
                variant="ghost" size="sm"
                onClick={() => removeHeader(idx)}
                aria-label="Remove header"
                title="Remove header"
              >✕</Button>
            </div>
          ))}
        </div>
      </div>

      {/* Models editor — at least one required. */}
      <div>
        <div className="pv-section-head">
          <span className="pv-section-label">Models</span>
          <Button variant="ghost" size="sm" onClick={addModel}>+ Add model</Button>
        </div>
        {errors.model_id && <span className="atelier-input-error">{errors.model_id}</span>}
        <div className="pv-rows">
          {models.map((m, idx) => (
            <div key={idx} className="pv-row">
              <input
                className="atelier-input"
                value={m.id}
                onChange={(e) => updateModel(idx, { id: e.target.value })}
                placeholder="model-id (e.g. umans-glm-5.2)"
                aria-label="Model id"
              />
              <select
                className="atelier-input atelier-select"
                value={m.role}
                onChange={(e) => updateModel(idx, { role: e.target.value as Role })}
                aria-label="Model role"
              >
                <option value="coder">coder</option>
                <option value="utility">utility</option>
              </select>
              <button
                type="button"
                className={`pv-tools-toggle${m.tool_calls ? " on" : ""}`}
                onClick={() => updateModel(idx, { tool_calls: !m.tool_calls })}
                aria-pressed={m.tool_calls}
                aria-label="Toggle tools"
                title={m.tool_calls ? "tools on" : "tools off"}
              >
                <span className="pv-tools-dot" />
                tools
              </button>
              {models.length > 1 && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => removeModel(idx)}
                  aria-label="Remove model"
                  title="Remove model"
                >✕</Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <Input
        ref={keyRef}
        label="API key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={isEdit ? "unchanged — enter to replace" : "sk-…"}
        error={errors.api_key}
      />
      {isEdit && keyEmpty && <div className="pv-key-hint">enter the key to test</div>}

      {result && (
        <div className="pv-result">
          <Badge tone="default" className="pv-result-chip">{result.latency_ms}ms</Badge>
          <Badge tone={result.completion ? "ok" : "bad"} className="pv-result-chip">
            completion {result.completion ? "ok" : "fail"}
          </Badge>
          <Badge tone={result.tool_calls ? "ok" : "bad"} className="pv-result-chip">
            tools {result.tool_calls ? "ok" : "fail"}
          </Badge>
          {!result.ok && failText && <div className="pv-result-fail">{failText}</div>}
        </div>
      )}

      <div className="pv-editor-actions">
        {isEdit && (
          <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
        )}
        <Button
          variant="ghost"
          onClick={test}
          disabled={busy || keyEmpty}
          loading={busy && !result}
          title={keyEmpty ? "enter the key to test" : "Test this configuration"}
        >
          Test
        </Button>
        <Button variant="primary" onClick={save} disabled={busy} loading={busy}>
          {isEdit ? "Save" : "Add provider"}
        </Button>
      </div>
    </div>
  );
}

function EmptyHero({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="pv-hero">
      <h3>Connect your first model</h3>
      <p>Pick a preset below, paste your API key, and you're running. Edit any field you like.</p>
      <ProviderEditor mode="add" onSaved={onSaved} />
    </div>
  );
}
