// Issuance journal: who read, saved or deleted which entry (agent thread, project, name,
// time, the stated purpose). Passive: it never blocks anything and never stores a value.
// Pure SQL over a better-sqlite3 handle so node --test can run it on an in-memory database.
import type Database from "better-sqlite3";

/**
 * Appended to the plugin's `bb.storage.migrate` list. The host hashes every shipped statement
 * and rejects an edited or reordered one, so the three statements below stay exactly as 0.3.2
 * shipped them. `env_grants` and `env_grant_requests` belong to the grant flow removed in 0.3.3:
 * the tables stay in place, empty and unused, and nothing reads or writes them.
 */
export const JOURNAL_MIGRATIONS: string[] = [
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

/** issued = a value was handed out; saved / deleted = an agent changed the catalog. */
export type JournalOutcome = "issued" | "saved" | "deleted";

export interface JournalEntry {
  id: number;
  at: string;
  name: string;
  /** Older rows (0.3.2) may also carry denied / timeout / cancelled. */
  outcome: string;
  /** tool | cli */
  via: string | null;
  threadId: string | null;
  threadTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  purpose: string | null;
}

export interface JournalInput {
  name: string;
  outcome: JournalOutcome;
  via: string;
  threadId?: string | null;
  threadTitle?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  purpose?: string | null;
}

interface JournalRow {
  id: number;
  at: string;
  name: string;
  outcome: string;
  via: string | null;
  thread_id: string | null;
  thread_title: string | null;
  project_id: string | null;
  project_name: string | null;
  purpose: string | null;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text.slice(0, max);
};

const toEntry = (r: JournalRow): JournalEntry => ({
  id: r.id,
  at: r.at,
  name: r.name,
  outcome: r.outcome,
  via: r.via,
  threadId: r.thread_id,
  threadTitle: r.thread_title,
  projectId: r.project_id,
  projectName: r.project_name,
  purpose: r.purpose,
});

export function createJournalStore(db: Database.Database, deps: { now?: () => string } = {}) {
  const now = deps.now ?? (() => new Date().toISOString());

  function addJournal(input: JournalInput): void {
    db.prepare(
      `INSERT INTO env_issuance_journal
       (at, name, outcome, via, thread_id, thread_title, project_id, project_name, purpose)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      now(),
      input.name.trim(),
      input.outcome,
      clip(input.via, 20),
      clip(input.threadId, 80),
      clip(input.threadTitle, 200),
      clip(input.projectId, 80),
      clip(input.projectName, 200),
      clip(input.purpose, 500),
    );
  }

  function listJournal(limit = 200, name?: string | null): JournalEntry[] {
    const cap = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const rows = name
      ? db
          .prepare<[string, number], JournalRow>(`SELECT * FROM env_issuance_journal WHERE name = ? ORDER BY id DESC LIMIT ?`)
          .all(name.trim(), cap)
      : db.prepare<[number], JournalRow>(`SELECT * FROM env_issuance_journal ORDER BY id DESC LIMIT ?`).all(cap);
    return rows.map(toEntry);
  }

  return { addJournal, listJournal };
}

export type JournalStore = ReturnType<typeof createJournalStore>;
