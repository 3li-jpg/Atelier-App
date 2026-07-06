// Provider validation (FR-1.3): cheap completion + tool-call round-trip.
import type { ProviderConfig } from "@atelier/schema";

export interface ValidationResult {
  ok: boolean;
  latency_ms: number;
  completion: boolean;
  tool_calls: boolean;
  error?: string;
}

export async function validateProvider(
  cfg: ProviderConfig, apiKey: string, modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ValidationResult> {
  const t0 = Date.now();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...cfg.headers,
  };
  try {
    // 1. Cheap completion
    const c = await fetchImpl(`${cfg.base_url}/chat/completions`, {
      method: "POST", headers,
      body: JSON.stringify({ model: modelId, max_tokens: 16, messages: [{ role: "user", content: "Say ok" }] }),
    });
    if (!c.ok) return { ok: false, latency_ms: Date.now() - t0, completion: false, tool_calls: false, error: `completion: ${c.status} ${await c.text()}` };
    const latency_ms = Date.now() - t0;

    // 2. Tool-call round-trip
    const t = await fetchImpl(`${cfg.base_url}/chat/completions`, {
      method: "POST", headers,
      body: JSON.stringify({
        model: modelId, max_tokens: 128,
        messages: [{ role: "user", content: "Run the command `ls` using the bash tool." }],
        tools: [{ type: "function", function: {
          name: "bash", description: "Run a shell command",
          parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
        } }],
      }),
    });
    const tj: any = t.ok ? await t.json() : null;
    const madeToolCall = Boolean(tj?.choices?.[0]?.message?.tool_calls?.length);
    return { ok: madeToolCall, latency_ms, completion: true, tool_calls: madeToolCall,
      ...(madeToolCall ? {} : { error: "model did not emit a tool call — unusable for agentic coding" }) };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - t0, completion: false, tool_calls: false, error: String(err) };
  }
}

// ponytail: openai-chat dialect only; add anthropic-messages adapter when a
// user actually configures one (D5's quirks table hangs off this later).
