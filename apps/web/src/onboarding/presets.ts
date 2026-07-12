import type { ProviderCreate } from "../api.ts";

// Provider presets for the BYOK step. Selecting a preset pre-fills the
// provider form fields (name, base_url, dialect, model_id). The user still
// needs to paste their own API key.
export type ProviderPreset = {
  id: string;
  label: string;
  description: string;
  build: (apiKey: string) => ProviderCreate;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Access 100+ models via one API key",
    build: (apiKey) => ({
      name: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      dialect: "openai-chat",
      models: [{ id: "anthropic/claude-3.5-sonnet", role: "coder", tool_calls: true }],
      api_key: apiKey,
    }),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Direct Claude API (anthropic-messages dialect)",
    build: (apiKey) => ({
      name: "Anthropic",
      base_url: "https://api.anthropic.com/v1",
      dialect: "anthropic-messages",
      models: [{ id: "claude-3.5-sonnet", role: "coder", tool_calls: true }],
      api_key: apiKey,
    }),
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o / o1 via the OpenAI API",
    build: (apiKey) => ({
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      dialect: "openai-chat",
      models: [{ id: "gpt-4o", role: "coder", tool_calls: true }],
      api_key: apiKey,
    }),
  },
  {
    id: "glm",
    label: "GLM (Zhipu)",
    description: "Zhipu AI GLM models",
    build: (apiKey) => ({
      name: "GLM",
      base_url: "https://open.bigmodel.cn/api/paas/v4",
      dialect: "openai-chat",
      models: [{ id: "glm-4-plus", role: "coder", tool_calls: true }],
      api_key: apiKey,
    }),
  },
  {
    id: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible or Anthropic-compatible endpoint",
    build: (apiKey) => ({
      name: "Custom Provider",
      base_url: "",
      dialect: "openai-chat",
      models: [{ id: "", role: "coder", tool_calls: true }],
      api_key: apiKey,
    }),
  },
];
