import { canTransition, type SessionState } from "@atelier/schema";
import type { SandboxProvider } from "@atelier/sandbox";
import type { Store } from "./store.ts";
import { decryptKey, sealConfig, type SealedConfig } from "./secrets.ts";

const RUNNER_IMAGE = process.env.RUNNER_IMAGE ?? "registry.fly.io/atelier-sandboxes:runner-v0";
const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";

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
    this.timers.set(sessionId, setTimeout(
      () => this.kill(sessionId, "wall-clock budget exceeded"),
      budgets.max_wall_clock_s * 1000,
    ));
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

  private clearBudget(sessionId: string): void {
    const t = this.timers.get(sessionId);
    if (t) { clearTimeout(t); this.timers.delete(sessionId); }
  }
}
