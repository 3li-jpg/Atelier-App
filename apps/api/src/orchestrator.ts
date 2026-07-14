import { canTransition, type SessionState } from "@atelier/schema";
import { E2BProvider, DaytonaProvider, LocalSandboxProvider } from "@atelier/sandbox";
import type { SandboxProvider } from "@atelier/sandbox";
import type { AnyStore } from "./pg-store.ts";
import { decryptKey, sealConfig, type SealedConfig } from "./secrets.ts";

// Thrown when a provider's key_ciphertext can't be decrypted (stale — encrypted
// with an old MASTER_KEY). The handshake route catches this → 422 + the session
// is already failed + an actionable error event emitted.
export class StaleProviderKeyError extends Error {
  providerName: string;
  constructor(providerName: string) {
    super(`provider "${providerName}" has an undecryptable (stale) API key`);
    this.name = "StaleProviderKeyError";
    this.providerName = providerName;
  }
}

const RUNNER_IMAGE = process.env.RUNNER_IMAGE ?? "registry.fly.io/atelier-sandboxes:runner-v1";
const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";

// Infer the provider name for routing destroy/resume/stop. SandboxProvider has
// no name field, so check the instance/constructor. Unknown (incl. test fakes)
// falls back to "fly" — matches the existing hardcoded `provider: "fly"` literals.
function sandboxProviderName(s: SandboxProvider): string {
  if (s instanceof E2BProvider) return "e2b";
  if (s instanceof DaytonaProvider) return "daytona";
  if (s instanceof LocalSandboxProvider) return "local";
  return "fly";
}

// Hibernation thresholds from measured data (docs/spike-notes.md):
// suspend→start ≈ 0.75 s. Read lazily so tests (and ops) can override via env.
const envMs = (name: string, dflt: number) => Number(process.env[name] ?? dflt);
// 300 s, NOT PRD D6's 30 s: interactive workspaces ping
// activity at most once per 60 s, so the fuse must exceed the ping throttle.
// No stop-demotion: a stopped Fly machine loses its rootfs (= the workspace).
const SUSPEND_AFTER_MS = () => envMs("SUSPEND_AFTER_MS", 300_000);  // awaiting_user → suspend
const REAPER_INTERVAL_MS = () => envMs("REAPER_INTERVAL_MS", 60_000);

// Billable while the machine is alive (started); pauses when suspended/hibernated
// or destroyed. ponytail: billStart is in-memory — the accrued total persists,
// but the open interval is lost on crash (acceptable for the alpha).
const BILLABLE_STATES = new Set<SessionState>(["provisioning", "cloning", "setup", "running", "awaiting_user", "finalizing"]);

export class Orchestrator {
  private timers = new Map<string, NodeJS.Timeout>();
  private billStart = new Map<string, number>();
  // ponytail: in-memory turn counter (one per `running` supervisor state) —
  // lost on crash like billStart; re-seed from the events table if revival matters.
  private turns = new Map<string, number>();
  private store: AnyStore;
  private sandbox: SandboxProvider;
  private clock: () => number;

  constructor(store: AnyStore, sandbox: SandboxProvider, now: () => number = Date.now) {
    this.store = store; this.sandbox = sandbox; this.clock = now;
  }

  // Resolve a per-session sandbox when the user has BYOC compute creds.
  // ponytail: instantiate per-launch; cache if allocation cost matters.
  private async sandboxFor(sessionId: string): Promise<SandboxProvider> {
    const s = await this.store.getSession(sessionId);
    if (!s || !s.user_id) return this.sandbox;
    const creds = await this.store.getComputeKey(s.user_id);
    if (!creds) return this.sandbox;
    if (creds.provider === "e2b") return new E2BProvider(creds.key);
    if (creds.provider === "daytona") return new DaytonaProvider(creds.key, "");
    return this.sandbox;
  }

  // Resolve the sandbox for an EXISTING session (destroy/wake/finish).
  // sandbox_provider is the string stored at launch, or null for old sessions.
  private async sandboxForRef(s: any): Promise<SandboxProvider> {
    const name = s.sandbox_provider;
    if (name === "e2b" && s.user_id) {
      const c = await this.store.getComputeKey(s.user_id);
      if (c) return new E2BProvider(c.key);
    }
    if (name === "daytona" && s.user_id) {
      const c = await this.store.getComputeKey(s.user_id);
      if (c) return new DaytonaProvider(c.key, "");
    }
    return this.sandbox;
  }

  private async accrueBilling(sessionId: string, from: SessionState, to: SessionState): Promise<void> {
    const wasBillable = BILLABLE_STATES.has(from);
    const isBillable = BILLABLE_STATES.has(to);
    if (wasBillable && !isBillable) {
      const t0 = this.billStart.get(sessionId);
      if (t0 !== undefined) {
        await this.store.addBilled(sessionId, this.clock() - t0);
        this.billStart.delete(sessionId);
      }
    } else if (!wasBillable && isBillable) {
      this.billStart.set(sessionId, this.clock());
    }
  }

  async transition(sessionId: string, to: SessionState): Promise<void> {
    const s = await this.store.getSession(sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    if (!canTransition(s.state, to)) {
      throw new Error(`illegal transition ${s.state} -> ${to}`);
    }
    await this.accrueBilling(sessionId, s.state, to);
    await this.store.setSessionState(sessionId, to);
    await this.store.appendEvent(sessionId, {
      ts: new Date().toISOString(), type: "state_change", payload: { from: s.state, state: to },
    });
    if (["completed", "failed", "cancelled"].includes(to)) this.clearBudget(sessionId);
  }

  async launch(sessionId: string): Promise<void> {
    const s = await this.store.getSession(sessionId);
    await this.transition(sessionId, "provisioning");
    const sandbox = await this.sandboxFor(sessionId);
    // record which provider this session uses so destroy/wake/finish route correctly
    await this.store.setSessionSandboxProvider(sessionId, sandboxProviderName(sandbox));

    // Secrets never enter machine env — the supervisor fetches them via the
    // sealed-box handshake (guide §2.6, POST /internal/sessions/:id/handshake).
    const ref = await sandbox.create({
      name: `ses-${sessionId.slice(0, 8)}`,
      image: RUNNER_IMAGE,
      env: {
        SESSION_ID: sessionId,
        HANDSHAKE_URL: `${PUBLIC_URL}/internal/sessions/${sessionId}/handshake`,
        EVENTS_URL: `${PUBLIC_URL}/internal/sessions/${sessionId}/events`,
        SESSION_TOKEN: s.session_token,
      },
      metadata: { atelier_session: sessionId },
    }).catch(async (err) => {
      await this.store.appendEvent(sessionId, { ts: new Date().toISOString(), type: "error", payload: { message: String(err) } });
      await this.transition(sessionId, "failed");
      throw err;
    });

    await this.store.setSessionState(sessionId, "provisioning", ref.id);
  }

  // Handshake: seal the full session config to the supervisor's pubkey.
  async handshake(sessionId: string, supervisorPubRaw: Buffer): Promise<SealedConfig> {
    const s = await this.store.getSession(sessionId);
    const provider = await this.store.getProvider(s.provider_id);
    let apiKey: string;
    try {
      apiKey = decryptKey(provider.key_ciphertext);
    } catch {
      // The provider's key was encrypted with a different MASTER_KEY (stale from
      // before the current secret was set). GCM auth-tag fails → undecryptable.
      // Surface a clear, actionable error instead of a bare 500 that strands the
      // session in provisioning. The user must re-add the provider.
      await this.store.appendEvent(sessionId, {
        ts: new Date().toISOString(), type: "error",
        payload: { message: `Provider "${provider.name}" has an undecryptable API key (encrypted with an old master key). Delete and re-add this provider in the Providers tab.`, hint: "re-add-provider" },
      });
      if (canTransition(s.state, "failed")) await this.transition(sessionId, "failed");
      throw new StaleProviderKeyError(provider.name);
    }
    return sealConfig(supervisorPubRaw, {
      repo_url: s.repo_url,
      branch: s.branch,
      task: s.task,
      toolsets: s.toolsets ? JSON.parse(s.toolsets) : undefined,
      llm_base_url: provider.base_url,
      llm_api_key: apiKey,
      llm_model: s.model_id,
      git_token: (await this.store.getUserToken(s.user_id)) ?? process.env.GIT_TOKEN ?? "",
    });
  }

  // Supervisor state reports arrive as state_change events; mirror them into the FSM.
  // Routed through accrueBilling (not just setSessionState) so supervisor-driven
  // terminal transitions settle the open billable segment — otherwise the final
  // segment after the last wake is never accrued (audit H3).
  // Returns false when the FSM rejects the transition (e.g. "completed" after
  // "failed") so the caller can drop the event instead of recording a lie.
  async onSupervisorState(sessionId: string, state: string): Promise<boolean> {
    const s = await this.store.getSession(sessionId);
    if (!s || !canTransition(s.state, state as SessionState)) return false;
    await this.accrueBilling(sessionId, s.state, state as SessionState);
    await this.store.setSessionState(sessionId, state as SessionState);
    if (state === "running") {
      // a busy report cancels a pending suspend armed while awaiting_user
      // (audit H6) — otherwise a stale timer can suspend a working session.
      this.clearTimer(sessionId, "suspend");
      await this.noteTurn(sessionId);
    }
    if (state === "awaiting_user") this.scheduleSuspend(sessionId);
    if (["completed", "failed"].includes(state)) await this.reap(sessionId);
    return true;
  }

  // Count agent turns (a `running` state = one model invocation cycle) and
  // enforce the max_turns budget (audit H5). ponytail: in-memory counter.
  private async noteTurn(sessionId: string): Promise<void> {
    const s = await this.store.getSession(sessionId);
    if (!s) return;
    const budgets = JSON.parse(s.budgets ?? "{}");
    const maxTurns = budgets.max_turns;
    if (typeof maxTurns !== "number" || maxTurns <= 0) return; // <=0 = unlimited
    const n = (this.turns.get(sessionId) ?? 0) + 1;
    this.turns.set(sessionId, n);
    if (n > maxTurns) await this.kill(sessionId, `budget: max_turns (${maxTurns}) exceeded`);
  }

  // --- Hibernation (thresholds from spike data) ---
  private scheduleSuspend(sessionId: string): void {
    this.setTimer(sessionId, "suspend", SUSPEND_AFTER_MS(), async () => {
      const s = await this.store.getSession(sessionId);
      if (s?.state !== "awaiting_user" || !s.machine_id) return;
      const sandbox = await this.sandboxForRef(s);
      await sandbox.suspend({ id: s.machine_id, provider: s.sandbox_provider ?? "fly" }).catch(() => {});
      await this.transition(sessionId, "hibernated");
    });
  }

  // User replied: wake the machine and hand the session back to the supervisor.
  async wake(sessionId: string): Promise<void> {
    this.clearTimer(sessionId, "suspend");
    this.clearTimer(sessionId, "finish");
    const s = await this.store.getSession(sessionId);
    if (s?.state === "hibernated" && s.machine_id) {
      const sandbox = await this.sandboxForRef(s);
      const ref = { id: s.machine_id, provider: s.sandbox_provider ?? "fly" };
      await sandbox.resume(ref);
      await sandbox.waitFor(ref, "started", 30).catch(() => {}); // confirm resumed before handing back (audit L6)
      await this.transition(sessionId, "awaiting_user");
    }
  }

  async activity(sessionId: string): Promise<void> {
    await this.store.touchActivity(sessionId);
    const s = await this.store.getSession(sessionId);
    if (s?.state === "awaiting_user") this.scheduleSuspend(sessionId);
  }

  async finish(sessionId: string): Promise<void> {
    const s = await this.store.getSession(sessionId);
    if (!s) return;
    if (!s.machine_id) {
      if (canTransition(s.state, "cancelled")) await this.transition(sessionId, "cancelled");
      return;
    }
    const sandbox = await this.sandboxForRef(s);
    const ref = { id: s.machine_id, provider: s.sandbox_provider ?? "fly" };
    if (s.state === "hibernated") {
      await sandbox.resume(ref);
      await sandbox.waitFor(ref, "started", 30).catch(() => {});
      await this.transition(sessionId, "awaiting_user");
    }
    await sandbox.stop(ref).catch(() => {});
    this.setTimer(sessionId, "finish", 180_000, () => { void this.kill(sessionId, "finish timed out"); });
  }

  // --- Reaper: TTL enforcement independent of the happy path ---
  startReaper(): NodeJS.Timeout {
    const t = setInterval(() => this.sweep().catch(() => {}), REAPER_INTERVAL_MS());
    t.unref();
    return t;
  }

  async sweep(now: number = this.clock()): Promise<void> {
    for (const row of await this.store.listSessions()) {
      if (["completed", "failed", "cancelled"].includes(row.state)) continue;
      const s = await this.store.getSession(row.id);
      const budgets = JSON.parse(s.budgets ?? "{}");
      const maxMs = (budgets.max_wall_clock_s ?? 1800) * 1000;
      const started = new Date(s.started_at + "Z").getTime();
      if (now - started > 24 * 60 * 60 * 1000) {
        await this.kill(s.id, "reaper: absolute 24h cap exceeded");
        continue;
      }
      // Idle budget: an actively-used workspace
      // must not be finished at max_wall_clock_s — the 24h cap above is the only
      // absolute limit. Idle past budget → graceful finish (work gets pushed).
      const lastMs = new Date((s.last_activity ?? s.started_at) + "Z").getTime();
      if (now - lastMs > maxMs) await this.finish(s.id);
    }
    await this.reapOrphans();
  }

  // Orphan scan: destroy machines still alive on the substrate whose session is
  // terminal or gone from the DB. Guards against leaked spend when the happy-path
  // reap missed a machine (process crash mid-session, etc.). Only touches machines
  // tagged with our atelier_session metadata — never foreign machines in the app.
  private async reapOrphans(): Promise<void> {
    const machines = await this.sandbox.listMachines().catch(() => []);
    for (const m of machines) {
      const sid = m.metadata?.atelier_session;
      if (!sid || m.state === "destroyed") continue;
      const s = await this.store.getSession(sid);
      if (!s || ["completed", "failed", "cancelled"].includes(s.state)) {
        await this.sandbox.destroy({ id: m.id, provider: m.provider })
          .catch((err) => console.warn(`reaper: failed to destroy orphan ${m.id}: ${err}`));
        if (s) await this.store.appendEvent(sid, {
          ts: new Date().toISOString(), type: "error",
          payload: { message: `reaper: destroyed orphan machine ${m.id} (session ${s.state})` },
        });
      }
    }
  }

  async kill(sessionId: string, reason: string): Promise<void> {
    await this.store.appendEvent(sessionId, { ts: new Date().toISOString(), type: "error", payload: { message: reason } });
    const s = await this.store.getSession(sessionId);
    if (s?.state && canTransition(s.state, "failed")) await this.transition(sessionId, "failed");
    await this.reap(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    await this.transition(sessionId, "cancelled");
    await this.reap(sessionId);
  }

  private async reap(sessionId: string): Promise<void> {
    this.clearBudget(sessionId);
    const s = await this.store.getSession(sessionId);
    if (s?.machine_id) {
      const sandbox = await this.sandboxForRef(s);
      await sandbox.destroy({ id: s.machine_id, provider: s.sandbox_provider ?? "fly" }).catch(() => {});
    }
  }

  // --- timer bookkeeping (budget, suspend, finish — all per-session, all unref'd) ---
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
    for (const kind of ["budget", "suspend", "finish"]) this.clearTimer(sessionId, kind);
    this.turns.delete(sessionId);
  }
}
