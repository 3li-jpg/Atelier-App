import type { SandboxProvider, SandboxRef, SandboxCreateConfig, SandboxState, MachineInfo } from "./index.ts";

const FLY_STATES: Record<string, SandboxState> = {
  created: "created", starting: "starting", started: "started",
  suspending: "suspended", suspended: "suspended",
  stopping: "stopped", stopped: "stopped",
  destroying: "destroyed", destroyed: "destroyed",
};

export class FlyMachinesProvider implements SandboxProvider {
  private app: string;
  private token: string;
  private fetchImpl: typeof fetch;
  private base: string;

  constructor(app: string, token: string, fetchImpl: typeof fetch = fetch, base = "https://api.machines.dev/v1") {
    this.app = app; this.token = token; this.fetchImpl = fetchImpl; this.base = base;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.base}/apps/${this.app}/machines${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`fly ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async create(cfg: SandboxCreateConfig): Promise<SandboxRef> {
    const m = await this.req("POST", "", {
      name: cfg.name,
      region: cfg.region ?? "sjc", // sea is deprecated on Fly as of mid-2026
      config: {
        image: cfg.image,
        guest: { cpu_kind: "shared", cpus: cfg.cpus ?? 2, memory_mb: cfg.memory_mb ?? 4096 },
        auto_destroy: true,
        restart: { policy: "no" },
        kill_timeout: 120,
        env: cfg.env,
        metadata: cfg.metadata,
      },
    });
    return { id: m.id, provider: "fly" };
  }

  suspend(ref: SandboxRef) { return this.req("POST", `/${ref.id}/suspend`); }
  resume(ref: SandboxRef) { return this.req("POST", `/${ref.id}/start`); }
  stop(ref: SandboxRef) { return this.req("POST", `/${ref.id}/stop`); }
  destroy(ref: SandboxRef) { return this.req("DELETE", `/${ref.id}?force=true`); }

  async listMachines(): Promise<MachineInfo[]> {
    const list = await this.req("GET", "");
    const machines = Array.isArray(list) ? list : [];
    return machines.map((m: any) => ({
      id: String(m.id),
      provider: "fly",
      state: FLY_STATES[m.state] ?? "created",
      metadata: (m.config?.metadata ?? {}) as Record<string, string>,
    }));
  }

  async status(ref: SandboxRef): Promise<SandboxState> {
    const m = await this.req("GET", `/${ref.id}`);
    return FLY_STATES[m.state] ?? "created";
  }

  async waitFor(ref: SandboxRef, state: SandboxState, timeoutS = 60): Promise<void> {
    await this.req("GET", `/${ref.id}/wait?state=${state}&timeout=${timeoutS}`);
  }
}
