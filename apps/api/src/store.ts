// ponytail: node:sqlite for the spike — same schema shape as the PRD's Postgres
// tables; swap to pg + Neon when multi-instance is real.
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Event, SessionState } from "@atelier/schema";
import { encryptKey, decryptKey } from "./secrets.ts";
import { getTier, getVpsSize } from "./plans.ts";

export const bus = new EventEmitter(); // in-process fan-out; Redis Streams when >1 instance
bus.setMaxListeners(0);

// add column if missing (alpha DBs predate user_id scoping); ignore duplicate-column
const safeAlter = (db: DatabaseSync, sql: string) => { try { db.exec(sql); } catch { /* duplicate column */ } };

export class Store {
  private db: DatabaseSync;

  constructor(path = process.env.DB_PATH ?? "atelier.db") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      create table if not exists users (
        id text primary key, github_id integer unique, login text, name text,
        avatar_url text, github_token_ciphertext blob, created_at text);
      create table if not exists providers (
        id text primary key, name text, base_url text, dialect text,
        key_ciphertext blob, models text, quirks text, created_at text, user_id text);
      create table if not exists sessions (
        id text primary key, repo_url text, branch text, provider_id text,
        model_id text, task text, state text, machine_id text,
        permission_mode text, budgets text, session_token text,
        started_at text, ended_at text, billed_seconds integer default 0,
        user_id text, cpus integer, memory_mb integer);
      create table if not exists events (
        session_id text, seq integer, type text, payload text, ts text,
        primary key (session_id, seq));
    `);
    safeAlter(this.db, "alter table providers add column user_id text");
    safeAlter(this.db, "alter table sessions add column user_id text");
    safeAlter(this.db, "alter table users add column github_token_ciphertext blob");
    safeAlter(this.db, "alter table sessions add column last_activity text");
    safeAlter(this.db, "alter table users add column email text");
    safeAlter(this.db, "alter table users add column password_hash text");
    safeAlter(this.db, "alter table users add column plan text default 'free'");
    safeAlter(this.db, "alter table users add column compute_provider text");
    safeAlter(this.db, "alter table users add column compute_key_ciphertext blob");
    safeAlter(this.db, "alter table users add column role text default 'user'");
    safeAlter(this.db, "alter table sessions add column sandbox_provider text");
    safeAlter(this.db, "alter table sessions add column toolsets text");
    safeAlter(this.db, "alter table sessions add column cpus integer");
    safeAlter(this.db, "alter table sessions add column memory_mb integer");
    safeAlter(this.db, "alter table providers add column headers text");

    // ---- Billing: user_plan (task 1 of 5) ----
    this.db.exec(`
      create table if not exists user_plan (
        user_id text primary key,
        product text,
        tier text,
        status text,
        stripe_customer_id text,
        stripe_subscription_id text,
        trial_end text,
        current_period_start text,
        current_period_end text,
        vm_ref text,
        region text
      );
    `);
    // safeAlter for every column/table so existing DBs migrate.
    safeAlter(this.db, "alter table user_plan add column product text");
    safeAlter(this.db, "alter table user_plan add column tier text");
    safeAlter(this.db, "alter table user_plan add column status text");
    safeAlter(this.db, "alter table user_plan add column stripe_customer_id text");
    safeAlter(this.db, "alter table user_plan add column stripe_subscription_id text");
    safeAlter(this.db, "alter table user_plan add column trial_end text");
    safeAlter(this.db, "alter table user_plan add column current_period_start text");
    safeAlter(this.db, "alter table user_plan add column current_period_end text");
    safeAlter(this.db, "alter table user_plan add column vm_ref text");
    safeAlter(this.db, "alter table user_plan add column region text");

    // Abuse-guard: per-user trial counter.
    this.db.exec(`
      create table if not exists trial_counter (
        user_id text primary key,
        count integer default 0
      );
    `);

    this.db.exec(`
      create table if not exists legal_acceptances (
        user_id text, doc_id text, version text, accepted_at text,
        ip text, user_agent text,
        primary key (user_id, doc_id, version));
    `);

    this.db.exec(`
      create table if not exists audit_log (
        id integer primary key autoincrement, ts text, actor text,
        action text, target text, meta text);
    `);

    this.db.exec(`
      create table if not exists abuse_reports (
        id text primary key, type text, target_ref text, reporter_email text,
        reporter_name text, details text, status text default 'open', created_at text);
    `);

    this.db.exec(`create table if not exists consent (user_id text primary key, analytics integer, accepted_at text)`);
  }

  upsertUser(githubId: number, login: string, name: string | null, avatarUrl: string | null): string {
    const existing: any = this.db.prepare("select id from users where github_id = ?").get(githubId);
    if (existing) {
      this.db.prepare("update users set login = ?, name = ?, avatar_url = ? where id = ?")
        .run(login, name, avatarUrl, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    this.db.prepare("insert into users (id,github_id,login,name,avatar_url,created_at) values (?,?,?,?,?,datetime('now'))")
      .run(id, githubId, login, name, avatarUrl);
    return id;
  }

  getUser(id: string): any {
    return this.db.prepare("select id,github_id,login,name,avatar_url,role from users where id = ?").get(id) ?? null;
  }

  // --- Email/password auth ---
  createEmailUser(email: string, passwordHash: string): string {
    const id = randomUUID();
    this.db.prepare("insert into users (id,login,email,password_hash,created_at) values (?,?,?,?,datetime('now'))")
      .run(id, email, email, passwordHash);
    return id;
  }

  getEmailUser(email: string): any {
    return this.db.prepare("select id,email,password_hash from users where email = ?").get(email) ?? null;
  }

  storeUserToken(userId: string, plaintext: string): void {
    this.db.prepare("update users set github_token_ciphertext = ? where id = ?")
      .run(encryptKey(plaintext), userId);
  }

  getUserToken(userId: string): string | null {
    const row: any = this.db.prepare("select github_token_ciphertext from users where id = ?").get(userId);
    if (!row || !row.github_token_ciphertext) return null;
    return decryptKey(row.github_token_ciphertext);
  }

  createProvider(p: { name: string; base_url: string; dialect: string; key_ciphertext: Buffer; models: unknown; quirks?: unknown; headers?: Record<string,string>; user_id?: string }) {
    const id = randomUUID();
    this.db.prepare(`insert into providers (id,name,base_url,dialect,key_ciphertext,models,quirks,headers,created_at,user_id)
      values (?,?,?,?,?,?,?,?,datetime('now'),?)`)
      .run(id, p.name, p.base_url, p.dialect, p.key_ciphertext, JSON.stringify(p.models), JSON.stringify(p.quirks ?? {}), JSON.stringify(p.headers ?? {}), p.user_id ?? null);
    return id;
  }

  updateProvider(p: { id: string; name?: string; base_url?: string; dialect?: string; models?: unknown; headers?: Record<string,string>; quirks?: unknown; key_ciphertext?: Buffer }): void {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (p.name !== undefined) { fields.push("name = ?"); params.push(p.name); }
    if (p.base_url !== undefined) { fields.push("base_url = ?"); params.push(p.base_url); }
    if (p.dialect !== undefined) { fields.push("dialect = ?"); params.push(p.dialect); }
    if (p.models !== undefined) { fields.push("models = ?"); params.push(JSON.stringify(p.models)); }
    if (p.headers !== undefined) { fields.push("headers = ?"); params.push(JSON.stringify(p.headers)); }
    if (p.quirks !== undefined) { fields.push("quirks = ?"); params.push(JSON.stringify(p.quirks)); }
    if (p.key_ciphertext !== undefined) { fields.push("key_ciphertext = ?"); params.push(p.key_ciphertext); }
    if (!fields.length) return;
    params.push(p.id);
    this.db.prepare(`update providers set ${fields.join(", ")} where id = ?`).run(...params);
  }

  deleteProvider(id: string): void {
    this.db.prepare("delete from providers where id = ?").run(id);
  }

  getAccount(userId: string): any {
    return this.db.prepare(`select u.*, (select count(*) from sessions where user_id = u.id) as session_count,
      (select coalesce(sum(billed_seconds),0) from sessions where user_id = u.id) as billed_seconds
      from users u where u.id = ?`).get(userId) ?? null;
  }

  setCompute(userId: string, provider: string, keyCiphertext: Buffer): void {
    this.db.prepare("update users set compute_provider = ?, compute_key_ciphertext = ? where id = ?").run(provider, keyCiphertext, userId);
  }

  clearCompute(userId: string): void {
    this.db.prepare("update users set compute_provider = null, compute_key_ciphertext = null where id = ?").run(userId);
  }

  getComputeKey(userId: string): { provider: string; key: string } | null {
    const row: any = this.db.prepare("select compute_provider, compute_key_ciphertext from users where id = ?").get(userId);
    if (!row || !row.compute_key_ciphertext) return null;
    return { provider: row.compute_provider, key: decryptKey(row.compute_key_ciphertext) };
  }

  getProvider(id: string): any {
    const row: any = this.db.prepare("select * from providers where id = ?").get(id);
    if (!row) return null;
    return { ...row, models: JSON.parse(row.models), quirks: JSON.parse(row.quirks) };
  }

  listProviders(userId?: string): any[] {
    // key_ciphertext never leaves the store's read path for listings
    const rows = userId
      ? this.db.prepare("select id,name,base_url,dialect,models,created_at from providers where user_id = ? order by created_at desc").all(userId)
      : this.db.prepare("select id,name,base_url,dialect,models,created_at from providers order by created_at desc").all();
    return rows.map((r: any) => ({ ...r, models: JSON.parse(r.models) }));
  }

  createSession(s: { repo_url?: string; branch: string; provider_id: string; model_id: string; task: string; permission_mode: string; budgets: unknown; session_token: string; user_id?: string; toolsets?: string[] | null; sandbox_provider?: string | null; cpus?: number | null; memory_mb?: number | null }) {
    const id = randomUUID();
    this.db.prepare(`insert into sessions (id,repo_url,branch,provider_id,model_id,task,state,permission_mode,budgets,session_token,toolsets,sandbox_provider,started_at,user_id,cpus,memory_mb)
      values (?,?,?,?,?,?,'created',?,?,?,?,?,datetime('now'),?,?,?)`)
      .run(id, s.repo_url ?? null, s.branch, s.provider_id, s.model_id, s.task, s.permission_mode, JSON.stringify(s.budgets), s.session_token, JSON.stringify(s.toolsets ?? null), s.sandbox_provider ?? null, s.user_id ?? null, s.cpus ?? null, s.memory_mb ?? null);
    return id;
  }

  getSession(id: string): any {
    return this.db.prepare("select * from sessions where id = ?").get(id) ?? null;
  }

  listSessions(userId?: string): any[] {
    const cols = "id,repo_url,branch,model_id,task,state,sandbox_provider,cpus,memory_mb,started_at,ended_at";
    const rows = userId
      ? this.db.prepare(`select ${cols} from sessions where user_id = ? order by started_at desc`).all(userId)
      : this.db.prepare(`select ${cols} from sessions order by started_at desc`).all();
    return rows;
  }

  setSessionState(id: string, state: SessionState, machineId?: string) {
    if (machineId !== undefined) {
      this.db.prepare("update sessions set state = ?, machine_id = ? where id = ?").run(state, machineId, id);
    } else {
      this.db.prepare("update sessions set state = ? where id = ?").run(state, id);
    }
    if (["completed", "failed", "cancelled"].includes(state)) {
      this.db.prepare("update sessions set ended_at = datetime('now') where id = ?").run(id);
    }
  }

  setSessionSandboxProvider(id: string, provider: string): void {
    this.db.prepare("update sessions set sandbox_provider = ? where id = ?").run(provider, id);
  }

  // Live autonomy toggle (landing: "flip on autopilot"). Writes the row; the next
  // handshake re-seals the config so the runner applies the new permission policy.
  setPermissionMode(id: string, mode: string): void {
    this.db.prepare("update sessions set permission_mode = ? where id = ?").run(mode, id);
  }

  touchActivity(id: string) {
    this.db.prepare("update sessions set last_activity = datetime('now') where id = ?").run(id);
  }

  // billed_seconds is in whole seconds (Fly bills per second); sub-second deltas
  // round. ponytail: fine for the alpha; switch to ms if quota granularity matters.
  addBilled(sessionId: string, ms: number): void {
    this.db.prepare("update sessions set billed_seconds = billed_seconds + ? where id = ?")
      .run(Math.max(0, Math.round(ms / 1000)), sessionId);
  }

  // ---- Billing methods (task 1 of 5) ----
  getUserPlan(userId: string): any {
    return this.db.prepare("select * from user_plan where user_id = ?").get(userId) ?? null;
  }

  getUserPlanBySubscriptionId(subscriptionId: string): any {
    return this.db.prepare("select * from user_plan where stripe_subscription_id = ?").get(subscriptionId) ?? null;
  }

  getUserPlanByCustomerId(customerId: string): any {
    return this.db.prepare("select * from user_plan where stripe_customer_id = ?").get(customerId) ?? null;
  }

  setUserPlan(
    userId: string,
    plan: {
      product: string;
      tier: string;
      status: string;
      stripe_customer_id?: string | null;
      stripe_subscription_id?: string | null;
      trial_end?: string | null;
      current_period_start?: string | null;
      current_period_end?: string | null;
      vm_ref?: string | null;
      region?: string | null;
    },
  ): void {
    const existing = this.db.prepare("select user_id from user_plan where user_id = ?").get(userId);
    if (existing) {
      this.db.prepare(`update user_plan set
        product = ?, tier = ?, status = ?,
        stripe_customer_id = ?, stripe_subscription_id = ?,
        trial_end = ?, current_period_start = ?, current_period_end = ?,
        vm_ref = ?, region = ?
        where user_id = ?`).run(
        plan.product, plan.tier, plan.status,
        plan.stripe_customer_id ?? null,
        plan.stripe_subscription_id ?? null,
        plan.trial_end ?? null,
        plan.current_period_start ?? null,
        plan.current_period_end ?? null,
        plan.vm_ref ?? null,
        plan.region ?? null,
        userId,
      );
    } else {
      this.db.prepare(`insert into user_plan
        (user_id, product, tier, status, stripe_customer_id, stripe_subscription_id,
         trial_end, current_period_start, current_period_end, vm_ref, region)
        values (?,?,?,?,?,?,?,?,?,?,?)`).run(
        userId,
        plan.product,
        plan.tier,
        plan.status,
        plan.stripe_customer_id ?? null,
        plan.stripe_subscription_id ?? null,
        plan.trial_end ?? null,
        plan.current_period_start ?? null,
        plan.current_period_end ?? null,
        plan.vm_ref ?? null,
        plan.region ?? null,
      );
    }
  }

  getUserUsage(userId: string): any {
    const plan = this.getUserPlan(userId);
    if (!plan) return null;
    const product = plan.product;
    const tier = plan.tier;
    const spec = product === "sandbox" ? getTier(tier) : getVpsSize(tier);
    if (!spec) return null;

    if (product === "vps") {
      return {
        product,
        tier,
        included_hours: null,
        used_hours: 0,
        remaining_hours: null,
        status: plan.status,
        trial_end: plan.trial_end,
      };
    }

    const includedHours = (spec as any).included_hours ?? 0;
    const periodStart = plan.current_period_start;
    const usedSeconds = this.db.prepare(
      "select coalesce(sum(billed_seconds),0) as s from sessions where user_id = ? and (started_at >= ? or ? is null)",
    ).get(userId, periodStart, periodStart) as { s: number };
    const usedHours = (usedSeconds?.s ?? 0) / 3600;
    return {
      product,
      tier,
      included_hours: includedHours,
      used_hours: usedHours,
      remaining_hours: Math.max(0, includedHours - usedHours),
      status: plan.status,
      trial_end: plan.trial_end,
    };
  }

  getTrialCount(): number {
    const row: any = this.db.prepare("select coalesce(sum(count),0) as c from trial_counter").get();
    return row?.c ?? 0;
  }

  incrementTrialCount(userId: string): void {
    this.db.prepare(`insert into trial_counter (user_id, count) values (?,1)
      on conflict(user_id) do update set count = count + 1`).run(userId);
  }

  appendEvent(sessionId: string, e: Omit<Event, "seq" | "session_id">): Event {
    const row: any = this.db.prepare("select coalesce(max(seq),0) + 1 as seq from events where session_id = ?").get(sessionId);
    const stored: Event = { ...e, session_id: sessionId, seq: row.seq };
    this.db.prepare("insert into events (session_id,seq,type,payload,ts) values (?,?,?,?,?)")
      .run(sessionId, row.seq, e.type, JSON.stringify(e.payload), e.ts);
    bus.emit(`events:${sessionId}`, stored);
    return stored;
  }

  eventsAfter(sessionId: string, cursor: number): Event[] {
    return this.db.prepare("select seq,type,payload,ts from events where session_id = ? and seq > ? order by seq").all(sessionId, cursor)
      .map((r: any) => ({ session_id: sessionId, seq: r.seq, type: r.type, payload: JSON.parse(r.payload), ts: r.ts }));
  }

  // sqlite has no FK cascade on events — delete them explicitly before the row.
  // ponytail: two statements, no transaction; a crash between them leaves orphan
  // event rows only, which are unreachable (queries key on session existence).
  deleteSession(id: string): void {
    this.db.prepare("delete from events where session_id = ?").run(id);
    this.db.prepare("delete from sessions where id = ?").run(id);
  }

  async recordAcceptance(userId: string, docId: string, version: string, ip: string, userAgent: string): Promise<void> {
    this.db.prepare(`insert or ignore into legal_acceptances (user_id, doc_id, version, accepted_at, ip, user_agent)
      values (?,?,?,?,datetime('now'),?)`).run(userId, docId, version, ip, userAgent);
  }

  async currentAcceptances(userId: string): Promise<Record<string, string>> {
    // latest version per doc — sqlite has no DISTINCT ON; group by + max.
    const rows: any[] = this.db.prepare(
      `select doc_id, version from legal_acceptances where user_id = ?
       group by doc_id having version = max(version)`).all(userId);
    return Object.fromEntries(rows.map((r) => [r.doc_id, r.version]));
  }

  async deleteAcceptances(userId: string): Promise<void> {
    this.db.prepare("delete from legal_acceptances where user_id = ?").run(userId);
  }

  async appendAudit(e: { actor: string; action: string; target: string; meta: object }): Promise<void> {
    this.db.prepare(`insert into audit_log (ts, actor, action, target, meta) values (datetime('now'),?,?,?,?)`)
      .run(e.actor, e.action, e.target, JSON.stringify(e.meta ?? {}));
  }

  async createAbuseReport(r: { type: string; target_ref: string; reporter_email: string; reporter_name: string; details: string }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`insert into abuse_reports (id,type,target_ref,reporter_email,reporter_name,details,status,created_at)
      values (?,?,?,?,?,?,'open',datetime('now'))`).run(id, r.type, r.target_ref, r.reporter_email, r.reporter_name, r.details);
    return id;
  }
  async actionAbuseReport(id: string, status: string): Promise<void> {
    this.db.prepare("update abuse_reports set status = ? where id = ?").run(status, id);
  }
  async getAbuseReport(id: string): Promise<any> {
    return this.db.prepare("select * from abuse_reports where id = ?").get(id) ?? null;
  }
  async strikeCount(userId: string): Promise<number> {
    const row: any = this.db.prepare("select count(*) as c from abuse_reports where target_ref = ? and status = 'actioned'").get(`user:${userId}`);
    return row?.c ?? 0;
  }
  async setUserRole(userId: string, role: string): Promise<void> {
    this.db.prepare("update users set role = ? where id = ?").run(role, userId);
  }

  async setConsent(userId: string, analytics: boolean): Promise<void> {
    this.db.prepare(`insert into consent (user_id, analytics, accepted_at) values (?,?,datetime('now'))
      on conflict(user_id) do update set analytics=excluded.analytics, accepted_at=datetime('now')`).run(userId, analytics ? 1 : 0);
  }

  async anonymizeUser(userId: string): Promise<void> {
    this.db.prepare("update users set login='deleted', email=null, github_token_ciphertext=null, compute_key_ciphertext=null, password_hash=null where id=?").run(userId);
  }

  async deleteEventsOlderThan(days: number): Promise<void> {
    this.db.prepare(`delete from events where ts < datetime('now', ?)`).run(`-${days} days`);
  }
  async listCanceledVpsBefore(dateIso: string): Promise<{ user_id: string; vm_ref: string }[]> {
    return this.db.prepare(`select user_id, vm_ref from user_plan where product='vps' and status='canceled' and vm_ref is not null and current_period_end < ?`).all(dateIso)
      .filter((r: any) => r.vm_ref);
  }
}
