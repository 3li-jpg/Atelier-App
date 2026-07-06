export type SandboxState = "created" | "starting" | "started" | "suspended" | "stopped" | "destroyed";

export interface SandboxRef { id: string; provider: string }

export interface MachineInfo {
  id: string;
  provider: string;
  state: SandboxState;
  metadata: Record<string, string>;
}

export interface SandboxCreateConfig {
  name: string;
  region?: string;
  image: string;
  env: Record<string, string>;
  cpus?: number;
  memory_mb?: number;
  metadata?: Record<string, string>;
}

export interface SandboxProvider {
  create(cfg: SandboxCreateConfig): Promise<SandboxRef>;
  suspend(ref: SandboxRef): Promise<void>;
  resume(ref: SandboxRef): Promise<void>;
  stop(ref: SandboxRef): Promise<void>;
  destroy(ref: SandboxRef): Promise<void>;
  status(ref: SandboxRef): Promise<SandboxState>;
  waitFor(ref: SandboxRef, state: SandboxState, timeoutS?: number): Promise<void>;
  listMachines(): Promise<MachineInfo[]>;
}

export { FlyMachinesProvider } from "./fly.ts";
