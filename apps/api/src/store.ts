// ponytail: node:sqlite for the spike — same schema shape as the PRD's Postgres
// tables; swap to pg + Neon when multi-instance is real.
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Event, SessionState } from "@atelier/schema";

export const bus = new EventEmitter(); // in-process fan-out; Redis Streams when >1 instance
bus.setMaxListeners(0);

export class Store {
  private db: DatabaseSync;

  constructor(path = process.env.DB_PATH ?? "atelier.db") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      create table if not exists providers (
        id text primary key, name text, base_url text, dialect text,
        key_ciphertext blob, models text, quirks text, created_at text);
      create table if not exists sessions (
        id text primary key, repo_url text, branch text, provider_id text,
        model_id text, task text, state text, machine_id text,
        permission_mode text, budgets text, session_token text,
        started_at text, ended_at text, billed_seconds integer default 0);
      create table if not exists events (
        session_id text, seq integer, type text, payload text, ts text,
        primary key (session_id, seq));
    `);
  }

  createProvider(p: { name: string; base_url: string; dialect: string; key_ciphertext: Buffer; models: unknown; quirks?: unknown }) {
    const id = randomUUID();
    this.db.prepare(`insert into providers (id,name,base_url,dialect,key_ciphertext,models,quirks,created_at)
      values (?,?,?,?,?,?,?,datetime('now'))`)
      .run(id, p.name, p.base_url, p.dialect, p.key_ciphertext, JSON.stringify(p.models), JSON.stringify(p.quirks ?? {}));
    return id;
  }

  getProvider(id: string): any {
    const row: any = this.db.prepare("select * from providers where id = ?").get(id);
    if (!row) return null;
    return { ...row, models: JSON.parse(row.models), quirks: JSON.parse(row.quirks) };
  }

  listProviders(): any[] {
    // key_ciphertext never leaves the store's read path for listings
    return this.db.prepare("select id,name,base_url,dialect,models,created_at from providers").all()
      .map((r: any) => ({ ...r, models: JSON.parse(r.models) }));
  }

  createSession(s: { repo_url: string; branch: string; provider_id: string; model_id: string; task: string; permission_mode: string; budgets: unknown; session_token: string }) {
    const id = randomUUID();
    this.db.prepare(`insert into sessions (id,repo_url,branch,provider_id,model_id,task,state,permission_mode,budgets,session_token,started_at)
      values (?,?,?,?,?,?,'created',?,?,?,datetime('now'))`)
      .run(id, s.repo_url, s.branch, s.provider_id, s.model_id, s.task, s.permission_mode, JSON.stringify(s.budgets), s.session_token);
    return id;
  }

  getSession(id: string): any {
    return this.db.prepare("select * from sessions where id = ?").get(id) ?? null;
  }

  listSessions(): any[] {
    return this.db.prepare("select id,repo_url,branch,model_id,task,state,started_at,ended_at from sessions order by started_at desc").all();
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
