import type { SandboxProvider, SandboxRef, SandboxCreateConfig, SandboxState, MachineInfo } from "./index.ts";

const DAYTONA_STATES: Record<string, SandboxState> = {
  created: "created", starting: "starting", started: "started",
  suspended: "suspended", stopping: "stopped", stopped: "stopped",
  destroyed: "destroyed",
};

export class DaytonaProvider implements SandboxProvider {
  private apiKey: string;
  private workspaceId: string;
  private fetchImpl: typeof fetch;
  private base: string;

  constructor(apiKey: string, workspaceId: string, fetchImpl: typeof fetch = fetch, base = "https://api.daytona.io/v1") {
    this.apiKey = apiKey; this.workspaceId = workspaceId; this.fetchImpl = fetchImpl; this.base = base;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.base}/workspace/${this.workspaceId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`daytona ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async create(cfg: SandboxCreateConfig): Promise<SandboxRef> {
    const m = await this.req("POST", "/sandbox", {
      name: cfg.name,
      image: cfg.image,
      env: cfg.env,
      resources: { cpus: cfg.cpus ?? 2, memory: cfg.memory_mb ?? 4096 },
      metadata: cfg.metadata,
    });
    return { id: m.id, provider: "daytona" };
  }

  suspend(ref: SandboxRef) { return this.req("POST", `/${ref.id}/suspend`); }
  resume(ref: SandboxRef) { return this.req("POST", `/${ref.id}/start`); }
  stop(ref: SandboxRef) { return this.req("POST", `/${ref.id}/stop`); }
  destroy(ref: SandboxRef) { return this.req("DELETE", `/${ref.id}?force=true`); }

  async listMachines(): Promise<MachineInfo[]> {
    const list = await this.req("GET", "/sandbox");
    const machines = Array.isArray(list) ? list : [];
    return machines.map((m: any) => ({
      id: String(m.id),
      provider: "daytona",
      state: DAYTONA_STATES[m.state] ?? "created",
      metadata: (m.metadata ?? {}) as Record<string, string>,
    }));
  }

  async status(ref: SandboxRef): Promise<SandboxState> {
    const m = await this.req("GET", `/${ref.id}`);
    return DAYTONA_STATES[m.state] ?? "created";
  }

  async waitFor(ref: SandboxRef, state: SandboxState, timeoutS = 60): Promise<void> {
    const deadline = Date.now() + timeoutS * 1000;
    while (Date.now() < deadline) {
      if (await this.status(ref) === state) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`daytona waitFor: timeout waiting for ${state}`);
  }
}
