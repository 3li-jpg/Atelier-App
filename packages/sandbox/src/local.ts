// LocalSandboxProvider — runs the supervisor as a local subprocess (the agent
// runs on the host via the installed `hermes`, no Fly microVM). Selected when
// SANDBOX=local. ponytail: no process isolation (it's your own machine), no
// suspend/resume (no-op), and the process group is killed on destroy.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { SandboxProvider, SandboxRef, SandboxCreateConfig, SandboxState, MachineInfo } from "./index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/sandbox/src -> ../../../runner = <repo>/runner (absolute; cwd is apps/api at runtime)
const RUNNER_DIR = process.env.RUNNER_DIR ?? resolve(__dirname, "../../../runner");
const WORKSPACE_ROOT = process.env.RUNNER_WORKSPACE ?? "/tmp/atelier";

export class LocalSandboxProvider implements SandboxProvider {
  private procs = new Map<string, { pid: number; sessionId: string; log: string }>();

  async create(cfg: SandboxCreateConfig): Promise<SandboxRef> {
    const sessionId = cfg.metadata?.atelier_session ?? "unknown";
    const workspace = `${WORKSPACE_ROOT}/${sessionId.slice(0, 8)}`;
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...cfg.env,
      SKIP_FIREWALL: "1",
      RUNNER_BIN: RUNNER_DIR,
      WORKSPACE: workspace,
      PATH: `${process.env.HOME ?? ""}/.local/bin:${process.env.PATH ?? ""}`,
    };
    const child = spawn("bash", [`${RUNNER_DIR}/supervisor.sh`], {
      env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.unref();
    const pid = child.pid ?? 0;
    const log = `${workspace}/supervisor.log`;
    child.stdout?.on("data", (d) => process.stdout.write(`[supervisor ${pid}] ${d}`));
    child.stderr?.on("data", (d) => process.stderr.write(`[supervisor ${pid}] ${d}`));
    this.procs.set(String(pid), { pid, sessionId, log });
    return { id: String(pid), provider: "local" };
  }

  private alive(id: string): boolean {
    const p = this.procs.get(id);
    if (!p) return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  }

  async suspend(): Promise<void> { /* ponytail: local mode does not suspend */ }
  async resume(): Promise<void> { /* ponytail: local mode does not suspend */ }
  async stop(ref: SandboxRef): Promise<void> { await this.destroy(ref); }
  async destroy(ref: SandboxRef): Promise<void> {
    const p = this.procs.get(ref.id);
    if (!p) return;
    try { process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ }
    setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } }, 2000);
    this.procs.delete(ref.id);
  }
  async status(ref: SandboxRef): Promise<SandboxState> {
    return this.alive(ref.id) ? "started" : "destroyed";
  }
  async waitFor(ref: SandboxRef, state: SandboxState, timeoutS = 60): Promise<void> {
    const deadline = Date.now() + timeoutS * 1000;
    while (Date.now() < deadline) {
      if ((await this.status(ref)) === state) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  async listMachines(): Promise<MachineInfo[]> {
    const out: MachineInfo[] = [];
    for (const [id, p] of this.procs) {
      let alive = false;
      try { process.kill(p.pid, 0); alive = true; } catch { /* dead */ }
      out.push({ id, provider: "local", state: alive ? "started" : "destroyed", metadata: { atelier_session: p.sessionId } });
    }
    return out;
  }
}
