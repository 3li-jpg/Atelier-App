// ponytail: node:sqlite for the spike — same schema shape as the PRD's Postgres
// tables; swap to pg + Neon when multi-instance is real.
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Event, SessionState } from "@atelier/schema";
import { encryptKey, decryptKey } from "./secrets.ts";

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
        started_at text, ended_at text, billed_seconds integer default 0, user_id text);
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
    return this.db.prepare("select id,github_id,login,name,avatar_url from users where id = ?").get(id) ?? null;
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

  createProvider(p: { name: string; base_url: string; dialect: string; key_ciphertext: Buffer; models: unknown; quirks?: unknown; user_id?: string }) {
    const id = randomUUID();
    this.db.prepare(`insert into providers (id,name,base_url,dialect,key_ciphertext,models,quirks,created_at,user_id)
      values (?,?,?,?,?,?,?,datetime('now'),?)`)
      .run(id, p.name, p.base_url, p.dialect, p.key_ciphertext, JSON.stringify(p.models), JSON.stringify(p.quirks ?? {}), p.user_id ?? null);
    return id;
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

  createSession(s: { repo_url: string; branch: string; provider_id: string; model_id: string; task: string; permission_mode: string; budgets: unknown; session_token: string; user_id?: string }) {
    const id = randomUUID();
    this.db.prepare(`insert into sessions (id,repo_url,branch,provider_id,model_id,task,state,permission_mode,budgets,session_token,started_at,user_id)
      values (?,?,?,?,?,?,'created',?,?,?,datetime('now'),?)`)
      .run(id, s.repo_url, s.branch, s.provider_id, s.model_id, s.task, s.permission_mode, JSON.stringify(s.budgets), s.session_token, s.user_id ?? null);
    return id;
  }

  getSession(id: string): any {
    return this.db.prepare("select * from sessions where id = ?").get(id) ?? null;
  }

  listSessions(userId?: string): any[] {
    const rows = userId
      ? this.db.prepare("select id,repo_url,branch,model_id,task,state,started_at,ended_at from sessions where user_id = ? order by started_at desc").all(userId)
      : this.db.prepare("select id,repo_url,branch,model_id,task,state,started_at,ended_at from sessions order by started_at desc").all();
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

  touchActivity(id: string) {
    this.db.prepare("update sessions set last_activity = datetime('now') where id = ?").run(id);
  }

  // billed_seconds is in whole seconds (Fly bills per second); sub-second deltas
  // round. ponytail: fine for the alpha; switch to ms if quota granularity matters.
  addBilled(sessionId: string, ms: number): void {
    this.db.prepare("update sessions set billed_seconds = billed_seconds + ? where id = ?")
      .run(Math.max(0, Math.round(ms / 1000)), sessionId);
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
}
