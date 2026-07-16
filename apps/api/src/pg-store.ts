// PgStore: the Store surface, async, backed by Postgres — in prod that's
// Supabase, spoken to over the plain wire protocol with postgres.js (no
// supabase-js: we need a database, not their REST layer). Selected by
// DATABASE_URL in index.ts; the sqlite Store stays the zero-config default
// for tests, local dev, and self-hosters.
//
// Timestamps are stored as text in sqlite's UTC format ("YYYY-MM-DD HH:MM:SS")
// so every existing `new Date(x + "Z")` consumer works unchanged.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import type { Event, SessionState } from "@atelier/schema";
import { encryptKey, decryptKey } from "./secrets.ts";
import { bus, type Store } from "./store.ts";

// Everything downstream (orchestrator, routes) awaits store calls, so either
// backend satisfies this union.
export type AnyStore = Store | PgStore;

const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export class PgStore {
  private sql: ReturnType<typeof postgres>;

  // prepare:false — Supabase's connection pooler (pgbouncer in transaction
  // mode, port 6543) rejects named prepared statements.
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, max: 10, onnotice: () => {} });
  }

  async init(): Promise<this> {
    await this.sql.unsafe(`
      create table if not exists users (
        id text primary key, github_id bigint unique, login text, name text,
        avatar_url text, github_token_ciphertext bytea, created_at text,
        email text, password_hash text, plan text default 'free',
        compute_provider text, compute_key_ciphertext bytea);
      create table if not exists providers (
        id text primary key, name text, base_url text, dialect text,
        key_ciphertext bytea, models text, quirks text, created_at text,
        user_id text, headers text);
      create table if not exists sessions (
        id text primary key, repo_url text, branch text, provider_id text,
        model_id text, task text, state text, machine_id text,
        permission_mode text, budgets text, session_token text,
        started_at text, ended_at text, billed_seconds integer default 0,
        user_id text, last_activity text, sandbox_provider text, toolsets text,
        cpus integer, memory_mb integer);
      create table if not exists events (
        session_id text, seq integer, type text, payload text, ts text,
        primary key (session_id, seq));
    `);
    // existing DBs predate these columns; IF NOT EXISTS keeps it idempotent (Supabase is v15+)
    await this.sql.unsafe(`
      alter table users add column if not exists plan text default 'free';
      alter table users add column if not exists compute_provider text;
      alter table users add column if not exists compute_key_ciphertext bytea;
      alter table users add column if not exists role text default 'user';
      alter table providers add column if not exists headers text;
      alter table sessions add column if not exists sandbox_provider text;
      alter table sessions add column if not exists toolsets text;
      alter table sessions add column if not exists cpus integer;
      alter table sessions add column if not exists memory_mb integer;

      -- Billing: user_plan (task 1 of 5)
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
      alter table user_plan add column if not exists product text;
      alter table user_plan add column if not exists tier text;
      alter table user_plan add column if not exists status text;
      alter table user_plan add column if not exists stripe_customer_id text;
      alter table user_plan add column if not exists stripe_subscription_id text;
      alter table user_plan add column if not exists trial_end text;
      alter table user_plan add column if not exists current_period_start text;
      alter table user_plan add column if not exists current_period_end text;
      alter table user_plan add column if not exists vm_ref text;
      alter table user_plan add column if not exists region text;

      create table if not exists trial_counter (
        user_id text primary key,
        count integer default 0
      );

      create table if not exists legal_acceptances (
        user_id text, doc_id text, version text, accepted_at text,
        ip text, user_agent text,
        primary key (user_id, doc_id, version));

      create table if not exists audit_log (
        id bigserial primary key, ts text, actor text,
        action text, target text, meta text);
    `);
    return this;
  }

  async close(): Promise<void> { await this.sql.end(); }

  async upsertUser(githubId: number, login: string, name: string | null, avatarUrl: string | null): Promise<string> {
    const [existing] = await this.sql`select id from users where github_id = ${githubId}`;
    if (existing) {
      await this.sql`update users set login = ${login}, name = ${name}, avatar_url = ${avatarUrl} where id = ${existing.id}`;
      return existing.id;
    }
    const id = randomUUID();
    await this.sql`insert into users (id,github_id,login,name,avatar_url,created_at)
      values (${id},${githubId},${login},${name},${avatarUrl},${utcNow()})`;
    return id;
  }

  async getUser(id: string): Promise<any> {
    const [row] = await this.sql`select id,github_id,login,name,avatar_url,role from users where id = ${id}`;
    return row ?? null;
  }

  async createEmailUser(email: string, passwordHash: string): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into users (id,login,email,password_hash,created_at) values (${id},${email},${email},${passwordHash},${utcNow()})`;
    return id;
  }

  async getEmailUser(email: string): Promise<any> {
    const [row] = await this.sql`select id,email,password_hash from users where email = ${email}`;
    return row ?? null;
  }

  async storeUserToken(userId: string, plaintext: string): Promise<void> {
    await this.sql`update users set github_token_ciphertext = ${encryptKey(plaintext)} where id = ${userId}`;
  }

  async getUserToken(userId: string): Promise<string | null> {
    const [row] = await this.sql`select github_token_ciphertext from users where id = ${userId}`;
    if (!row?.github_token_ciphertext) return null;
    return decryptKey(row.github_token_ciphertext);
  }

  async createProvider(p: { name: string; base_url: string; dialect: string; key_ciphertext: Buffer; models: unknown; quirks?: unknown; headers?: Record<string,string>; user_id?: string }): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into providers (id,name,base_url,dialect,key_ciphertext,models,quirks,headers,created_at,user_id)
      values (${id},${p.name},${p.base_url},${p.dialect},${p.key_ciphertext},${JSON.stringify(p.models)},${JSON.stringify(p.quirks ?? {})},${JSON.stringify(p.headers ?? {})},${utcNow()},${p.user_id ?? null})`;
    return id;
  }

  async getProvider(id: string): Promise<any> {
    const [row] = await this.sql`select * from providers where id = ${id}`;
    if (!row) return null;
    return { ...row, models: JSON.parse(row.models), quirks: JSON.parse(row.quirks) };
  }

  // postgres.js tagged template can't take dynamic column names on the SET
  // clause, so build a parameterized string + values array for unsafe(...).
  async updateProvider(p: { id: string; name?: string; base_url?: string; dialect?: string; models?: unknown; headers?: Record<string,string>; quirks?: unknown; key_ciphertext?: Buffer }): Promise<void> {
    const fields: string[] = [];
    const vals: any[] = [];
    if (p.name !== undefined) { fields.push('name = $' + (vals.length + 1)); vals.push(p.name); }
    if (p.base_url !== undefined) { fields.push('base_url = $' + (vals.length + 1)); vals.push(p.base_url); }
    if (p.dialect !== undefined) { fields.push('dialect = $' + (vals.length + 1)); vals.push(p.dialect); }
    if (p.models !== undefined) { fields.push('models = $' + (vals.length + 1)); vals.push(JSON.stringify(p.models)); }
    if (p.headers !== undefined) { fields.push('headers = $' + (vals.length + 1)); vals.push(JSON.stringify(p.headers)); }
    if (p.quirks !== undefined) { fields.push('quirks = $' + (vals.length + 1)); vals.push(JSON.stringify(p.quirks)); }
    if (p.key_ciphertext !== undefined) { fields.push('key_ciphertext = $' + (vals.length + 1)); vals.push(p.key_ciphertext); }
    if (!fields.length) return;
    vals.push(p.id);
    await this.sql.unsafe('update providers set ' + fields.join(', ') + ' where id = $' + vals.length, vals);
  }

  async deleteProvider(id: string): Promise<void> {
    await this.sql`delete from providers where id = ${id}`;
  }

  async getAccount(userId: string): Promise<any> {
    const [row] = await this.sql`select u.*, (select count(*) from sessions where user_id = u.id) as session_count, (select coalesce(sum(billed_seconds),0) from sessions where user_id = u.id) as billed_seconds from users u where u.id = ${userId}`;
    return row ?? null;
  }

  async setCompute(userId: string, provider: string, keyCiphertext: Buffer): Promise<void> {
    await this.sql`update users set compute_provider = ${provider}, compute_key_ciphertext = ${keyCiphertext} where id = ${userId}`;
  }

  async clearCompute(userId: string): Promise<void> {
    await this.sql`update users set compute_provider = null, compute_key_ciphertext = null where id = ${userId}`;
  }

  async getComputeKey(userId: string): Promise<{ provider: string; key: string } | null> {
    const [row] = await this.sql`select compute_provider, compute_key_ciphertext from users where id = ${userId}`;
    if (!row?.compute_key_ciphertext) return null;
    return { provider: row.compute_provider, key: decryptKey(row.compute_key_ciphertext) };
  }

  async listProviders(userId?: string): Promise<any[]> {
    const rows = userId
      ? await this.sql`select id,name,base_url,dialect,models,created_at from providers where user_id = ${userId} order by created_at desc`
      : await this.sql`select id,name,base_url,dialect,models,created_at from providers order by created_at desc`;
    return rows.map((r: any) => ({ ...r, models: JSON.parse(r.models) }));
  }

  async createSession(s: { repo_url?: string; branch: string; provider_id: string; model_id: string; task: string; permission_mode: string; budgets: unknown; session_token: string; user_id?: string; toolsets?: string[] | null; sandbox_provider?: string | null; cpus?: number | null; memory_mb?: number | null }): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into sessions (id,repo_url,branch,provider_id,model_id,task,state,permission_mode,budgets,session_token,toolsets,sandbox_provider,started_at,user_id,cpus,memory_mb)
      values (${id},${s.repo_url ?? null},${s.branch},${s.provider_id},${s.model_id},${s.task},'created',${s.permission_mode},${JSON.stringify(s.budgets)},${s.session_token},${JSON.stringify(s.toolsets ?? null)},${s.sandbox_provider ?? null},${utcNow()},${s.user_id ?? null},${s.cpus ?? null},${s.memory_mb ?? null})`;
    return id;
  }

  async getSession(id: string): Promise<any> {
    const [row] = await this.sql`select * from sessions where id = ${id}`;
    return row ?? null;
  }

  async listSessions(userId?: string): Promise<any[]> {
    return userId
      ? await this.sql`select id,repo_url,branch,model_id,task,state,sandbox_provider,started_at,ended_at from sessions where user_id = ${userId} order by started_at desc`
      : await this.sql`select id,repo_url,branch,model_id,task,state,sandbox_provider,started_at,ended_at from sessions order by started_at desc`;
  }

  async setSessionState(id: string, state: SessionState, machineId?: string): Promise<void> {
    if (machineId !== undefined) {
      await this.sql`update sessions set state = ${state}, machine_id = ${machineId} where id = ${id}`;
    } else {
      await this.sql`update sessions set state = ${state} where id = ${id}`;
    }
    if (["completed", "failed", "cancelled"].includes(state)) {
      await this.sql`update sessions set ended_at = ${utcNow()} where id = ${id}`;
    }
  }

  async setSessionSandboxProvider(id: string, provider: string): Promise<void> {
    await this.sql`update sessions set sandbox_provider = ${provider} where id = ${id}`;
  }

  async touchActivity(id: string): Promise<void> {
    await this.sql`update sessions set last_activity = ${utcNow()} where id = ${id}`;
  }

  async addBilled(sessionId: string, ms: number): Promise<void> {
    await this.sql`update sessions set billed_seconds = billed_seconds + ${Math.max(0, Math.round(ms / 1000))} where id = ${sessionId}`;
  }

  // Atomic seq allocation (insert..select max+1) — race-safe for one API
  // instance. ponytail: under multi-instance writes a PK conflict is possible
  // and SSE fanout via `bus` is per-process; add retry + pg LISTEN/NOTIFY then.
  async appendEvent(sessionId: string, e: Omit<Event, "seq" | "session_id">): Promise<Event> {
    const [row] = await this.sql`
      insert into events (session_id, seq, type, payload, ts)
      select ${sessionId}, coalesce(max(seq),0) + 1, ${e.type}, ${JSON.stringify(e.payload)}, ${e.ts}
      from events where session_id = ${sessionId}
      returning seq`;
    const stored: Event = { ...e, session_id: sessionId, seq: Number(row.seq) };
    bus.emit(`events:${sessionId}`, stored);
    return stored;
  }

  async eventsAfter(sessionId: string, cursor: number): Promise<Event[]> {
    const rows = await this.sql`select seq,type,payload,ts from events where session_id = ${sessionId} and seq > ${cursor} order by seq`;
    return rows.map((r: any) => ({ session_id: sessionId, seq: r.seq, type: r.type, payload: JSON.parse(r.payload), ts: r.ts }));
  }

  // No FK cascade declared on events — delete both explicitly (mirrors sqlite Store).
  async deleteSession(id: string): Promise<void> {
    await this.sql`delete from events where session_id = ${id}`;
    await this.sql`delete from sessions where id = ${id}`;
  }

  async recordAcceptance(userId: string, docId: string, version: string, ip: string, userAgent: string): Promise<void> {
    await this.sql`insert into legal_acceptances (user_id, doc_id, version, accepted_at, ip, user_agent)
      values (${userId}, ${docId}, ${version}, ${utcNow()}, ${ip}, ${userAgent})
      on conflict (user_id, doc_id, version) do nothing`;
  }

  async currentAcceptances(userId: string): Promise<Record<string, string>> {
    const rows = await this.sql`
      select distinct on (doc_id) doc_id, version from legal_acceptances
      where user_id = ${userId} order by doc_id, version desc`;
    return Object.fromEntries(rows.map((r: any) => [r.doc_id, r.version]));
  }

  async deleteAcceptances(userId: string): Promise<void> {
    await this.sql`delete from legal_acceptances where user_id = ${userId}`;
  }

  async appendAudit(e: { actor: string; action: string; target: string; meta: object }): Promise<void> {
    await this.sql`insert into audit_log (ts, actor, action, target, meta)
      values (${utcNow()}, ${e.actor}, ${e.action}, ${e.target}, ${JSON.stringify(e.meta ?? {})})`;
  }

  // ---- Billing methods (task 1 of 5) ----
  async getUserPlan(userId: string): Promise<any> {
    const [row] = await this.sql`select * from user_plan where user_id = ${userId}`;
    return row ?? null;
  }

  async getUserPlanBySubscriptionId(subscriptionId: string): Promise<any> {
    const [row] = await this.sql`select * from user_plan where stripe_subscription_id = ${subscriptionId}`;
    return row ?? null;
  }

  async getUserPlanByCustomerId(customerId: string): Promise<any> {
    const [row] = await this.sql`select * from user_plan where stripe_customer_id = ${customerId}`;
    return row ?? null;
  }

  async setUserPlan(
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
  ): Promise<void> {
    const [existing] = await this.sql`select user_id from user_plan where user_id = ${userId}`;
    if (existing) {
      await this.sql`update user_plan set
        product = ${plan.product}, tier = ${plan.tier}, status = ${plan.status},
        stripe_customer_id = ${plan.stripe_customer_id ?? null},
        stripe_subscription_id = ${plan.stripe_subscription_id ?? null},
        trial_end = ${plan.trial_end ?? null},
        current_period_start = ${plan.current_period_start ?? null},
        current_period_end = ${plan.current_period_end ?? null},
        vm_ref = ${plan.vm_ref ?? null},
        region = ${plan.region ?? null}
        where user_id = ${userId}`;
    } else {
      await this.sql`insert into user_plan
        (user_id, product, tier, status, stripe_customer_id, stripe_subscription_id,
         trial_end, current_period_start, current_period_end, vm_ref, region)
        values (${userId}, ${plan.product}, ${plan.tier}, ${plan.status},
          ${plan.stripe_customer_id ?? null}, ${plan.stripe_subscription_id ?? null},
          ${plan.trial_end ?? null}, ${plan.current_period_start ?? null},
          ${plan.current_period_end ?? null}, ${plan.vm_ref ?? null}, ${plan.region ?? null})`;
    }
  }

  async getUserUsage(userId: string): Promise<any> {
    const plan = await this.getUserPlan(userId);
    if (!plan) return null;
    const { product, tier } = plan;
    const { getTier, getVpsSize } = await import("./plans.ts");
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
    const [{ s }] = await this.sql`
      select coalesce(sum(billed_seconds),0) as s from sessions
      where user_id = ${userId} and (started_at >= ${periodStart} or ${periodStart} is null)`;
    const usedHours = Number(s ?? 0) / 3600;
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

  async getTrialCount(): Promise<number> {
    const [{ c }] = await this.sql`select coalesce(sum(count),0) as c from trial_counter`;
    return Number(c ?? 0);
  }

  async incrementTrialCount(userId: string): Promise<void> {
    await this.sql`
      insert into trial_counter (user_id, count) values (${userId}, 1)
      on conflict (user_id) do update set count = trial_counter.count + 1`;
  }
}
