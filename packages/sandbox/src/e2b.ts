import type { SandboxProvider, SandboxRef, SandboxCreateConfig, SandboxState, MachineInfo } from "./index.ts";

const E2B_STATES: Record<string, SandboxState> = {
  running: "started", paused: "suspended", killed: "stopped",
  created: "created", starting: "starting",
};

export class E2BProvider implements SandboxProvider {
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private base: string;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch, base = "https://api.e2b.dev/v1") {
    this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.base = base;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.base}/sandboxes${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`e2b ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async create(cfg: SandboxCreateConfig): Promise<SandboxRef> {
    const m = await this.req("POST", "", {
      name: cfg.name,
      image: cfg.image,
      env: cfg.env,
      resources: { cpus: cfg.cpus ?? 2, memory_mb: cfg.memory_mb ?? 4096 },
      metadata: cfg.metadata,
    });
    return { id: m.sandboxID, provider: "e2b" };
  }

  suspend(ref: SandboxRef) { return this.req("POST", `/${ref.id}/pause`); }
  resume(ref: SandboxRef) { return this.req("POST", `/${ref.id}/resume`); }
  stop(ref: SandboxRef) { return this.req("POST", `/${ref.id}/kill`); }
  destroy(ref: SandboxRef) { return this.req("DELETE", `/${ref.id}`); }

  async listMachines(): Promise<MachineInfo[]> {
    const list = await this.req("GET", "");
    const machines = Array.isArray(list) ? list : [];
    return machines.map((m: any) => ({
      id: String(m.sandboxID),
      provider: "e2b",
      state: E2B_STATES[m.state] ?? "created",
      metadata: (m.metadata ?? {}) as Record<string, string>,
    }));
  }

  async status(ref: SandboxRef): Promise<SandboxState> {
    const m = await this.req("GET", `/${ref.id}`);
    return E2B_STATES[m.state] ?? "created";
  }

  async waitFor(ref: SandboxRef, state: SandboxState, timeoutS = 60): Promise<void> {
    const deadline = Date.now() + timeoutS * 1000;
    while (Date.now() < deadline) {
      if (await this.status(ref) === state) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`e2b waitFor: timeout waiting for ${state}`);
  }
}
