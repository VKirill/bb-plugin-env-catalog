// Grants: which agent thread / project may be handed which secret, the pending owner
// questions, and the issuance journal. Pure SQL over a better-sqlite3 handle so node --test
// can run it on an in-memory database. No value is ever stored here, only names and ids.
import type Database from "better-sqlite3";

/** Appended to the plugin's `bb.storage.migrate` list (statement index = migration id: append only). */
export const GRANT_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS env_grants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    label TEXT,
    granted_at TEXT NOT NULL,
    granted_by TEXT,
    UNIQUE (name, scope, scope_id)
  );`,
  `CREATE TABLE IF NOT EXISTS env_grant_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    project_id TEXT,
    thread_title TEXT,
    project_name TEXT,
    purpose TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    consumed_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS env_issuance_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    name TEXT NOT NULL,
    outcome TEXT NOT NULL,
    via TEXT,
    grant_kind TEXT,
    thread_id TEXT,
    thread_title TEXT,
    project_id TEXT,
    project_name TEXT,
    purpose TEXT,
    caller TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_env_journal_at ON env_issuance_journal(at);`,
];

export type GrantScope = "thread" | "project";
export type GrantDecision = "once" | "thread" | "project" | "deny";
export type RequestStatus = "pending" | GrantDecision | "expired";

export interface Grant {
  id: string;
  name: string;
  scope: GrantScope;
  scopeId: string;
  label: string | null;
  grantedAt: string;
  grantedBy: string | null;
}

export interface GrantRequest {
  id: string;
  name: string;
  threadId: string;
  projectId: string | null;
  threadTitle: string | null;
  projectName: string | null;
  purpose: string | null;
  source: string | null;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  consumedAt: string | null;
}

export type JournalOutcome = "issued" | "denied" | "timeout" | "cancelled";

export interface JournalEntry {
  id: number;
  at: string;
  name: string;
  outcome: JournalOutcome;
  /** tool | cli | plugin */
  via: string | null;
  /** once | thread | project | plugin (how the issue was authorised) */
  grantKind: string | null;
  threadId: string | null;
  threadTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  purpose: string | null;
  caller: string | null;
}

export interface JournalInput {
  name: string;
  outcome: JournalOutcome;
  via: string;
  grantKind?: string | null;
  threadId?: string | null;
  threadTitle?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  purpose?: string | null;
  caller?: string | null;
}

export interface RequestInput {
  name: string;
  threadId: string;
  projectId?: string | null;
  threadTitle?: string | null;
  projectName?: string | null;
  purpose?: string | null;
  source?: string | null;
}

interface GrantRow {
  id: string;
  name: string;
  scope: string;
  scope_id: string;
  label: string | null;
  granted_at: string;
  granted_by: string | null;
}
interface RequestRow {
  id: string;
  name: string;
  thread_id: string;
  project_id: string | null;
  thread_title: string | null;
  project_name: string | null;
  purpose: string | null;
  source: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  consumed_at: string | null;
}
interface JournalRow {
  id: number;
  at: string;
  name: string;
  outcome: string;
  via: string | null;
  grant_kind: string | null;
  thread_id: string | null;
  thread_title: string | null;
  project_id: string | null;
  project_name: string | null;
  purpose: string | null;
  caller: string | null;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text.slice(0, max);
};

const toGrant = (r: GrantRow): Grant => ({
  id: r.id,
  name: r.name,
  scope: r.scope === "project" ? "project" : "thread",
  scopeId: r.scope_id,
  label: r.label,
  grantedAt: r.granted_at,
  grantedBy: r.granted_by,
});

const toRequest = (r: RequestRow): GrantRequest => ({
  id: r.id,
  name: r.name,
  threadId: r.thread_id,
  projectId: r.project_id,
  threadTitle: r.thread_title,
  projectName: r.project_name,
  purpose: r.purpose,
  source: r.source,
  status: r.status as RequestStatus,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
  consumedAt: r.consumed_at,
});

const toJournal = (r: JournalRow): JournalEntry => ({
  id: r.id,
  at: r.at,
  name: r.name,
  outcome: r.outcome as JournalOutcome,
  via: r.via,
  grantKind: r.grant_kind,
  threadId: r.thread_id,
  threadTitle: r.thread_title,
  projectId: r.project_id,
  projectName: r.project_name,
  purpose: r.purpose,
  caller: r.caller,
});

export function createGrantStore(
  db: Database.Database,
  deps: { now?: () => string; newId?: () => string } = {},
) {
  const now = deps.now ?? (() => new Date().toISOString());
  let counter = 0;
  const newId =
    deps.newId ?? (() => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`);

  /** The grant that covers this name for this thread (thread scope first) or its project. */
  function findGrant(name: string, threadId: string, projectId?: string | null): Grant | null {
    const rows = db
      .prepare<[string, string, string], GrantRow>(
        `SELECT * FROM env_grants
         WHERE name = ? AND ((scope = 'thread' AND scope_id = ?) OR (scope = 'project' AND scope_id = ?))
         ORDER BY CASE scope WHEN 'thread' THEN 0 ELSE 1 END LIMIT 1`,
      )
      // An empty project id never matches a project grant.
      .all(name.trim(), threadId, projectId ?? "\u0000none");
    return rows[0] ? toGrant(rows[0]) : null;
  }

  function addGrant(input: {
    name: string;
    scope: GrantScope;
    scopeId: string;
    label?: string | null;
    grantedBy?: string | null;
  }): Grant {
    const name = input.name.trim();
    db.prepare(
      `INSERT INTO env_grants (id, name, scope, scope_id, label, granted_at, granted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (name, scope, scope_id) DO UPDATE SET label = excluded.label, granted_at = excluded.granted_at, granted_by = excluded.granted_by`,
    ).run(newId(), name, input.scope, input.scopeId, clip(input.label, 200), now(), clip(input.grantedBy, 80));
    const row = db
      .prepare<[string, string, string], GrantRow>(
        `SELECT * FROM env_grants WHERE name = ? AND scope = ? AND scope_id = ?`,
      )
      .get(name, input.scope, input.scopeId);
    return toGrant(row as GrantRow);
  }

  function listGrants(): Grant[] {
    return db
      .prepare<[], GrantRow>(`SELECT * FROM env_grants ORDER BY name ASC, granted_at DESC`)
      .all()
      .map(toGrant);
  }

  function revokeGrant(id: string): boolean {
    return db.prepare(`DELETE FROM env_grants WHERE id = ?`).run(id).changes > 0;
  }

  /** Grants of a deleted secret are dropped with it so a re-created name does not inherit them. */
  function revokeByName(name: string): number {
    return db.prepare(`DELETE FROM env_grants WHERE name = ?`).run(name.trim()).changes;
  }

  function createRequest(input: RequestInput): GrantRequest {
    const id = newId();
    db.prepare(
      `INSERT INTO env_grant_requests
       (id, name, thread_id, project_id, thread_title, project_name, purpose, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      input.name.trim(),
      input.threadId,
      input.projectId ?? null,
      clip(input.threadTitle, 200),
      clip(input.projectName, 200),
      clip(input.purpose, 500),
      clip(input.source, 40),
      now(),
    );
    return getRequest(id) as GrantRequest;
  }

  function getRequest(id: string): GrantRequest | null {
    const row = db.prepare<[string], RequestRow>(`SELECT * FROM env_grant_requests WHERE id = ?`).get(id);
    return row ? toRequest(row) : null;
  }

  function listPendingRequests(): GrantRequest[] {
    return db
      .prepare<[], RequestRow>(`SELECT * FROM env_grant_requests WHERE status = 'pending' ORDER BY created_at ASC`)
      .all()
      .map(toRequest);
  }

  /**
   * The owner's answer. Only a pending request can be decided (a second answer or a late one
   * after expiry changes nothing). "thread" / "project" also create the standing grant.
   * Returns the request as it stands afterwards, or null when it does not exist.
   */
  function decideRequest(id: string, answer: GrantDecision, decidedBy: string): GrantRequest | null {
    const request = getRequest(id);
    if (request === null) return null;
    if (request.status !== "pending") return request;
    // "Always for this project" without a project id cannot be stored: it becomes a one-time answer.
    const decision: GrantDecision = answer === "project" && !request.projectId ? "once" : answer;
    const run = db.transaction(() => {
      const info = db
        .prepare(
          `UPDATE env_grant_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`,
        )
        .run(decision, now(), clip(decidedBy, 80), id);
      if (info.changes === 0) return;
      if (decision === "thread") {
        addGrant({
          name: request.name,
          scope: "thread",
          scopeId: request.threadId,
          label: request.threadTitle ?? request.threadId,
          grantedBy: decidedBy,
        });
      } else if (decision === "project" && request.projectId) {
        addGrant({
          name: request.name,
          scope: "project",
          scopeId: request.projectId,
          label: request.projectName ?? request.projectId,
          grantedBy: decidedBy,
        });
      }
    });
    run();
    return getRequest(id);
  }

  /** An unanswered request that ended (timeout, thread stopped, form dismissed). */
  function expireRequest(id: string): void {
    db.prepare(`UPDATE env_grant_requests SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'`).run(
      now(),
      id,
    );
  }

  /** On start no waiter survives: whatever was pending cannot be answered any more. */
  function expireAllPending(): number {
    return db
      .prepare(`UPDATE env_grant_requests SET status = 'expired', decided_at = ? WHERE status = 'pending'`)
      .run(now()).changes;
  }

  /** A one-time answer is spent by exactly one reader. */
  function consumeOnce(id: string): boolean {
    return (
      db
        .prepare(`UPDATE env_grant_requests SET consumed_at = ? WHERE id = ? AND status = 'once' AND consumed_at IS NULL`)
        .run(now(), id).changes > 0
    );
  }

  function addJournal(input: JournalInput): void {
    db.prepare(
      `INSERT INTO env_issuance_journal
       (at, name, outcome, via, grant_kind, thread_id, thread_title, project_id, project_name, purpose, caller)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      now(),
      input.name.trim(),
      input.outcome,
      clip(input.via, 20),
      clip(input.grantKind, 20),
      clip(input.threadId, 80),
      clip(input.threadTitle, 200),
      clip(input.projectId, 80),
      clip(input.projectName, 200),
      clip(input.purpose, 500),
      clip(input.caller, 80),
    );
  }

  function listJournal(limit = 200, name?: string | null): JournalEntry[] {
    const cap = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const rows = name
      ? db
          .prepare<[string, number], JournalRow>(`SELECT * FROM env_issuance_journal WHERE name = ? ORDER BY id DESC LIMIT ?`)
          .all(name.trim(), cap)
      : db.prepare<[number], JournalRow>(`SELECT * FROM env_issuance_journal ORDER BY id DESC LIMIT ?`).all(cap);
    return rows.map(toJournal);
  }

  return {
    findGrant,
    addGrant,
    listGrants,
    revokeGrant,
    revokeByName,
    createRequest,
    getRequest,
    listPendingRequests,
    decideRequest,
    expireRequest,
    expireAllPending,
    consumeOnce,
    addJournal,
    listJournal,
  };
}

export type GrantStore = ReturnType<typeof createGrantStore>;
