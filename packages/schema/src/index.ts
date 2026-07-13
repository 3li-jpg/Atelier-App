import { z } from "zod";

export const EventType = z.enum([
  "assistant_text", "plan_update", "tool_call", "file_diff", "question",
  "test_run", "commit", "usage", "error", "state_change", "harness", "user_message",
  "todo", "subagent",
]);

export const Event = z.object({
  id: z.string().optional(),
  session_id: z.string().optional(),
  seq: z.number().int().optional(),
  ts: z.string(),
  type: EventType,
  payload: z.record(z.unknown()),
});
export type Event = z.infer<typeof Event>;

export const SessionState = z.enum([
  "created", "provisioning", "cloning", "setup", "running",
  "awaiting_user", "hibernated", "finalizing",
  "completed", "failed", "cancelled",
]);
export type SessionState = z.infer<typeof SessionState>;

// Legal FSM transitions (PRD §7). Terminal states have no exits.
export const TRANSITIONS: Record<SessionState, SessionState[]> = {
  created: ["provisioning", "cancelled"],
  provisioning: ["cloning", "failed", "cancelled"],
  cloning: ["setup", "failed", "cancelled"],
  setup: ["running", "failed", "cancelled"],
  running: ["awaiting_user", "finalizing", "failed", "cancelled"],
  awaiting_user: ["running", "hibernated", "finalizing", "failed", "cancelled"],
  hibernated: ["awaiting_user", "running", "finalizing", "failed", "cancelled"],
  finalizing: ["completed", "failed"],
  completed: [], failed: [], cancelled: [],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const Dialect = z.enum(["openai-chat", "openai-responses", "anthropic-messages"]);

export const ProviderConfig = z.object({
  name: z.string().min(1),
  base_url: z.string().url(),
  dialect: Dialect,
  headers: z.record(z.string()).optional(),
  models: z.array(z.object({
    id: z.string(),
    role: z.enum(["coder", "utility"]),
    context: z.number().int().positive().optional(),
    tool_calls: z.boolean().default(true),
  })).min(1),
  quirks: z.record(z.unknown()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const TOOLSETS = ["terminal","file","code_execution","web","search","browser","skills","memory","todo","clarify","delegation","cronjob","vision"] as const;
export type Toolset = typeof TOOLSETS[number];
export const ToolsetList = z.array(z.enum(TOOLSETS));

export const CreateSession = z.object({
  repo_url: z.string().url(),
  branch: z.string().default("main"),
  provider_id: z.string(),
  model_id: z.string(),
  task: z.string().default(""),
  toolsets: z.array(z.enum(TOOLSETS)).optional(),
  permission_mode: z.enum(["auto", "review", "plan"]).default("auto"),
  budgets: z.object({
    max_wall_clock_s: z.number().int().default(1800),
    max_turns: z.number().int().default(100),
  }).default({}),
});
export type CreateSession = z.infer<typeof CreateSession>;
