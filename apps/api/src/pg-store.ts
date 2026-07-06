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
        avatar_url text, github_token_ciphertext bytea, created_at text);
      create table if not exists providers (
        id text primary key, name text, base_url text, dialect text,
        key_ciphertext bytea, models text, quirks text, created_at text, user_id text);
      create table if not exists sessions (
        id text primary key, repo_url text, branch text, provider_id text,
        model_id text, task text, state text, machine_id text,
        permission_mode text, budgets text, session_token text,
        started_at text, ended_at text, billed_seconds integer default 0,
        user_id text, last_activity text);
      create table if not exists events (
        session_id text, seq integer, type text, payload text, ts text,
        primary key (session_id, seq));
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
    const [row] = await this.sql`select id,github_id,login,name,avatar_url from users where id = ${id}`;
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

  async createProvider(p: { name: string; base_url: string; dialect: string; key_ciphertext: Buffer; models: unknown; quirks?: unknown; user_id?: string }): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into providers (id,name,base_url,dialect,key_ciphertext,models,quirks,created_at,user_id)
      values (${id},${p.name},${p.base_url},${p.dialect},${p.key_ciphertext},${JSON.stringify(p.models)},${JSON.stringify(p.quirks ?? {})},${utcNow()},${p.user_id ?? null})`;
    return id;
  }

  async getProvider(id: string): Promise<any> {
    const [row] = await this.sql`select * from providers where id = ${id}`;
    if (!row) return null;
    return { ...row, models: JSON.parse(row.models), quirks: JSON.parse(row.quirks) };
  }

  async listProviders(userId?: string): Promise<any[]> {
    const rows = userId
      ? await this.sql`select id,name,base_url,dialect,models,created_at from providers where user_id = ${userId} order by created_at desc`
      : await this.sql`select id,name,base_url,dialect,models,created_at from providers order by created_at desc`;
    return rows.map((r: any) => ({ ...r, models: JSON.parse(r.models) }));
  }

  async createSession(s: { repo_url: string; branch: string; provider_id: string; model_id: string; task: string; permission_mode: string; budgets: unknown; session_token: string; user_id?: string }): Promise<string> {
    const id = randomUUID();
    await this.sql`insert into sessions (id,repo_url,branch,provider_id,model_id,task,state,permission_mode,budgets,session_token,started_at,user_id)
      values (${id},${s.repo_url},${s.branch},${s.provider_id},${s.model_id},${s.task},'created',${s.permission_mode},${JSON.stringify(s.budgets)},${s.session_token},${utcNow()},${s.user_id ?? null})`;
    return id;
  }

  async getSession(id: string): Promise<any> {
    const [row] = await this.sql`select * from sessions where id = ${id}`;
    return row ?? null;
  }

  async listSessions(userId?: string): Promise<any[]> {
    return userId
      ? await this.sql`select id,repo_url,branch,model_id,task,state,started_at,ended_at from sessions where user_id = ${userId} order by started_at desc`
      : await this.sql`select id,repo_url,branch,model_id,task,state,started_at,ended_at from sessions order by started_at desc`;
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
}
