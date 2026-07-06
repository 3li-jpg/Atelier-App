import { canTransition, type SessionState } from "@atelier/schema";
import type { SandboxProvider } from "@atelier/sandbox";
import type { Store } from "./store.ts";
import { decryptKey, sealConfig, type SealedConfig } from "./secrets.ts";

const RUNNER_IMAGE = process.env.RUNNER_IMAGE ?? "registry.fly.io/atelier-sandboxes:runner-v1";
const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";

// Hibernation thresholds from measured data (docs/spike-notes.md):
// suspend→start ≈ 0.75 s, stop→start ≈ 1.6 s, so hold RAM only briefly.
// Read lazily so tests (and ops) can override via env.
const envMs = (name: string, dflt: number) => Number(process.env[name] ?? dflt);
const SUSPEND_AFTER_MS = () => envMs("SUSPEND_AFTER_MS", 30_000);   // awaiting_user → suspend
const STOP_AFTER_MS = () => envMs("STOP_AFTER_MS", 120_000);        // suspended → stop
const REAPER_INTERVAL_MS = () => envMs("REAPER_INTERVAL_MS", 60_000);

export class Orchestrator {
  private timers = new Map<string, NodeJS.Timeout>();
  private store: Store;
  private sandbox: SandboxProvider;

  constructor(store: Store, sandbox: SandboxProvider) {
    this.store = store; this.sandbox = sandbox;
  }

  transition(sessionId: string, to: SessionState): void {
    const s = this.store.getSession(sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    if (!canTransition(s.state, to)) {
      throw new Error(`illegal transition ${s.state} -> ${to}`);
    }
    this.store.setSessionState(sessionId, to);
    this.store.appendEvent(sessionId, {
      ts: new Date().toISOString(), type: "state_change", payload: { from: s.state, state: to },
    });
    if (["completed", "failed", "cancelled"].includes(to)) this.clearBudget(sessionId);
  }

  async launch(sessionId: string): Promise<void> {
    const s = this.store.getSession(sessionId);
    this.transition(sessionId, "provisioning");

    // Secrets never enter machine env — the supervisor fetches them via the
    // sealed-box handshake (guide §2.6, POST /internal/sessions/:id/handshake).
    const ref = await this.sandbox.create({
      name: `ses-${sessionId.slice(0, 8)}`,
      image: RUNNER_IMAGE,
      env: {
        SESSION_ID: sessionId,
        HANDSHAKE_URL: `${PUBLIC_URL}/internal/sessions/${sessionId}/handshake`,
        EVENTS_URL: `${PUBLIC_URL}/internal/sessions/${sessionId}/events`,
        SESSION_TOKEN: s.session_token,
      },
      metadata: { atelier_session: sessionId },
    }).catch((err) => {
      this.store.appendEvent(sessionId, { ts: new Date().toISOString(), type: "error", payload: { message: String(err) } });
      this.transition(sessionId, "failed");
      throw err;
    });

    this.store.setSessionState(sessionId, "provisioning", ref.id);
    const budgets = JSON.parse(s.budgets);
    this.setTimer(sessionId, "budget", budgets.max_wall_clock_s * 1000,
      () => this.kill(sessionId, "wall-clock budget exceeded"));
  }

  // Handshake: seal the full session config to the supervisor's pubkey.
  handshake(sessionId: string, supervisorPubRaw: Buffer): SealedConfig {
    const s = this.store.getSession(sessionId);
    const provider = this.store.getProvider(s.provider_id);
    return sealConfig(supervisorPubRaw, {
      repo_url: s.repo_url,
      branch: s.branch,
      task: s.task,
      llm_base_url: provider.base_url,
      llm_api_key: decryptKey(provider.key_ciphertext),
      llm_model: s.model_id,
      git_token: process.env.GIT_TOKEN ?? "", // per-session installation tokens land with T5
    });
  }

  // Supervisor state reports arrive as state_change events; mirror them into the FSM.
  onSupervisorState(sessionId: string, state: string): void {
    const s = this.store.getSession(sessionId);
    if (s && canTransition(s.state, state as SessionState)) {
      this.store.setSessionState(sessionId, state as SessionState);
      if (["completed", "failed"].includes(state)) this.reap(sessionId);
      if (state === "awaiting_user") this.scheduleSuspend(sessionId);
    }
  }

  // --- Hibernation (PRD D6, thresholds from spike data) ---
  private scheduleSuspend(sessionId: string): void {
    this.setTimer(sessionId, "suspend", SUSPEND_AFTER_MS(), async () => {
      const s = this.store.getSession(sessionId);
      if (s?.state !== "awaiting_user" || !s.machine_id) return;
      await this.sandbox.suspend({ id: s.machine_id, provider: "fly" }).catch(() => {});
      this.transition(sessionId, "hibernated");
      this.setTimer(sessionId, "stop", STOP_AFTER_MS(), async () => {
        const s2 = this.store.getSession(sessionId);
        if (s2?.state === "hibernated" && s2.machine_id) {
          await this.sandbox.stop({ id: s2.machine_id, provider: "fly" }).catch(() => {});
        }
      });
    });
  }

  // User replied: wake the machine and hand the session back to the supervisor.
  async wake(sessionId: string): Promise<void> {
    this.clearTimer(sessionId, "suspend");
    this.clearTimer(sessionId, "stop");
    const s = this.store.getSession(sessionId);
    if (s?.state === "hibernated" && s.machine_id) {
      await this.sandbox.resume({ id: s.machine_id, provider: "fly" });
      this.transition(sessionId, "awaiting_user");
    }
  }

  // --- Reaper: TTL enforcement independent of the happy path ---
  startReaper(): NodeJS.Timeout {
    const t = setInterval(() => this.sweep().catch(() => {}), REAPER_INTERVAL_MS());
    t.unref();
    return t;
  }

  async sweep(now = Date.now()): Promise<void> {
    for (const row of this.store.listSessions()) {
      if (["completed", "failed", "cancelled"].includes(row.state)) continue;
      const s = this.store.getSession(row.id);
      const budgets = JSON.parse(s.budgets ?? "{}");
      const maxMs = (budgets.max_wall_clock_s ?? 1800) * 1000;
      const started = new Date(s.started_at + "Z").getTime();
      if (now - started > maxMs) await this.kill(s.id, "reaper: wall-clock TTL exceeded");
    }
  }

  async kill(sessionId: string, reason: string): Promise<void> {
    this.store.appendEvent(sessionId, { ts: new Date().toISOString(), type: "error", payload: { message: reason } });
    const s = this.store.getSession(sessionId);
    if (s?.state && canTransition(s.state, "failed")) this.transition(sessionId, "failed");
    await this.reap(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    this.transition(sessionId, "cancelled");
    await this.reap(sessionId);
  }

  private async reap(sessionId: string): Promise<void> {
    this.clearBudget(sessionId);
    const s = this.store.getSession(sessionId);
    if (s?.machine_id) {
      await this.sandbox.destroy({ id: s.machine_id, provider: "fly" }).catch(() => {});
    }
  }

  // --- timer bookkeeping (budget, suspend, stop — all per-session, all unref'd) ---
  private setTimer(sessionId: string, kind: string, ms: number, fn: () => void): void {
    this.clearTimer(sessionId, kind);
    const t = setTimeout(fn, ms);
    t.unref();
    this.timers.set(`${sessionId}:${kind}`, t);
  }

  private clearTimer(sessionId: string, kind: string): void {
    const t = this.timers.get(`${sessionId}:${kind}`);
    if (t) { clearTimeout(t); this.timers.delete(`${sessionId}:${kind}`); }
  }

  private clearBudget(sessionId: string): void {
    for (const kind of ["budget", "suspend", "stop"]) this.clearTimer(sessionId, kind);
  }
}
