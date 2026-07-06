// Provider conformance scoring for agentic coding (handoff T8 / guide §4).
// ponytail: openai-chat dialect only; add an anthropic-messages adapter when a
// user actually configures one (quirks table hangs off runConformance later).

import { pathToFileURL } from "node:url";

export interface Provider {
  base_url: string;
  headers: Record<string, string>;
}

export interface ConformanceReport {
  tool_call_fidelity: number;
  edit_reliability: boolean;
  streaming_stable: boolean;
  quirks: Record<string, unknown>;
  pass: boolean;
}

const BASH_TOOL = {
  type: "function",
  function: {
    name: "bash",
    description: "Run a shell command",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
};

const TOOL_CALL_PROMPTS = [
  "Run the command `ls` using the bash tool.",
  "Use the bash tool to execute `pwd`.",
  "List files in the current directory by calling the bash tool with `ls -la`.",
  "Execute `git status` via the bash tool.",
  "Run `echo hello` using the bash tool.",
  "Call the bash tool to run `whoami`.",
  "Use the bash tool to check disk usage with `df -h`.",
  "Run `date` using the bash tool.",
];

const EDIT_PROMPT =
  "Fix the off-by-one bug in this function so it sums inclusively from a to b. Return only the corrected function.\n\n" +
  "def sum_range(a, b):\n    total = 0\n    for i in range(a, b):\n        total += i\n    return total";
const EDIT_EXPECTED = "b + 1";

async function chat(provider: Provider, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<Response> {
  const res = await fetchImpl(`${provider.base_url}/chat/completions`, {
    method: "POST",
    headers: provider.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
  return res;
}

export async function scoreToolCallFidelity(provider: Provider, model: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  let hits = 0;
  for (const prompt of TOOL_CALL_PROMPTS) {
    const res = await chat(provider, {
      model, max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
      tools: [BASH_TOOL],
    }, fetchImpl);
    const j: any = await res.json();
    if (j?.choices?.[0]?.message?.tool_calls?.length) hits++;
  }
  return hits / TOOL_CALL_PROMPTS.length;
}

export async function scoreEditReliability(provider: Provider, model: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await chat(provider, {
    model, max_tokens: 256,
    messages: [{ role: "user", content: EDIT_PROMPT }],
  }, fetchImpl);
  const j: any = await res.json();
  const content: string = j?.choices?.[0]?.message?.content ?? "";
  return content.includes(EDIT_EXPECTED);
}

export async function scoreStreamingStability(provider: Provider, model: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await chat(provider, {
    model, max_tokens: 32, stream: true,
    messages: [{ role: "user", content: "Say ok" }],
  }, fetchImpl);
  if (!res.body) return false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;
  let buf = "";
  // ponytail: counts SSE data frames only; verify delta assembly when a quirk is reported.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") chunks++;
      }
    }
  }
  return chunks > 0;
}

export async function runConformance(
  baseUrl: string, apiKey: string, model: string, fetchImpl: typeof fetch = fetch,
): Promise<ConformanceReport> {
  const provider: Provider = {
    base_url: baseUrl,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  };
  const quirks: Record<string, unknown> = {};
  let tool_call_fidelity = 0;
  let edit_reliability = false;
  let streaming_stable = false;
  try { tool_call_fidelity = await scoreToolCallFidelity(provider, model, fetchImpl); }
  catch (e) { quirks.tool_call_error = String(e); }
  try { edit_reliability = await scoreEditReliability(provider, model, fetchImpl); }
  catch (e) { quirks.edit_error = String(e); }
  try { streaming_stable = await scoreStreamingStability(provider, model, fetchImpl); }
  catch (e) { quirks.streaming_error = String(e); }
  const pass = tool_call_fidelity >= 0.5 && edit_reliability && streaming_stable;
  return { tool_call_fidelity, edit_reliability, streaming_stable, quirks, pass };
}

// ponytail: edit reliability matches a single substring, not a real diff/apply;
// upgrade to a sandbox-backed apply check once packages/sandbox is wired in.

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baseUrl, apiKey, model] = process.argv.slice(2);
  // ponytail: positional argv only; add env fallback + flags when wired into ops.
  runConformance(baseUrl, apiKey, model).then((r) => console.log(JSON.stringify(r, null, 2)));
}
