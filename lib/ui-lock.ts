// Optional PIN or password for the Env Catalog page. The server keeps a scrypt hash of the
// passcode and hands the page a short-lived unlock token; every page RPC checks the token.
// Agent tools, the CLI and other plugins (callRpc) are not gated: they are how the catalog is used.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import {
  LOCK_KINDS,
  LOCK_LIMITS,
  LOCKED_MESSAGE,
  passcodeProblem,
  type LockKind,
} from "../contracts.js";

export { LOCKED_MESSAGE };

export const UI_LOCK_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS env_ui_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kind TEXT NOT NULL,
    hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS env_ui_lock_attempts (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    failures INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL
  );`,
];

const MAX_DELAY_MS = 60 * 60_000;
const KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class UiLockError extends Error {}

export interface LockConfig {
  /** Kind of the next passcode the owner sets. */
  kind: LockKind;
  autoLockMs: number;
  maxAttempts: number;
  lockoutMs: number;
}

export interface UiLockStatus {
  enabled: boolean;
  unlocked: boolean;
  retryAfterMs: number;
  /** Kind of the stored passcode, or of the next one while none is set. */
  kind: LockKind;
  newKind: LockKind;
  autoLockMs: number;
}

function clampInt(value: unknown, limit: { min: number; max: number; default: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return limit.default;
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

/** Plugin settings as stored, clamped to LOCK_LIMITS with defaults for missing values. */
export function parseLockConfig(raw: Record<string, unknown>): LockConfig {
  const kind = LOCK_KINDS.find((k) => k === raw.lockType) ?? "pin";
  return {
    kind,
    autoLockMs: clampInt(raw.autoLockMinutes, LOCK_LIMITS.autoLockMinutes) * 60_000,
    maxAttempts: clampInt(raw.maxAttempts, LOCK_LIMITS.maxAttempts),
    lockoutMs: clampInt(raw.lockoutMinutes, LOCK_LIMITS.lockoutMinutes) * 60_000,
  };
}

export function passcodeProblemText(kind: LockKind, passcode: string): string | null {
  const problem = passcodeProblem(kind, passcode);
  if (problem === "pinDigits") {
    return `The PIN must have ${LOCK_LIMITS.pinDigits.min} to ${LOCK_LIMITS.pinDigits.max} digits.`;
  }
  if (problem === "passwordLength") {
    return `The password must have ${LOCK_LIMITS.passwordLength.min} to ${LOCK_LIMITS.passwordLength.max} characters.`;
  }
  return null;
}

function derive(passcode: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passcode.normalize("NFKC"), salt, KEY_BYTES, SCRYPT_OPTIONS, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export function createUiLock(
  db: Database.Database,
  config: () => LockConfig,
  now: () => number = Date.now,
) {
  const sessions = new Map<string, number>();

  /** Kept in the database, so a plugin reload or a disable/enable does not reset the count. */
  const attempts = () =>
    (db.prepare("SELECT failures, blocked_until AS blockedUntil FROM env_ui_lock_attempts WHERE id = 1").get() as
      | { failures: number; blockedUntil: number }
      | undefined) ?? { failures: 0, blockedUntil: 0 };

  function saveAttempts(failures: number, blockedUntil: number): void {
    db.prepare(
      `INSERT INTO env_ui_lock_attempts (id, failures, blocked_until) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET failures = excluded.failures, blocked_until = excluded.blocked_until`,
    ).run(failures, blockedUntil);
  }

  const readRow = () =>
    db.prepare("SELECT kind, hash, salt FROM env_ui_lock WHERE id = 1").get() as
      | { kind: LockKind; hash: string; salt: string }
      | undefined;

  const enabled = () => readRow() !== undefined;

  function retryAfterMs(): number {
    return Math.max(0, attempts().blockedUntil - now());
  }

  function liveSession(token: string | null): boolean {
    if (!token) return false;
    const expiresAt = sessions.get(token);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function keepAlive(token: string | null): boolean {
    if (!liveSession(token)) return false;
    sessions.set(token as string, now() + config().autoLockMs);
    return true;
  }

  function openSession(): string {
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, now() + config().autoLockMs);
    return token;
  }

  let queue: Promise<unknown> = Promise.resolve();

  /** One check at a time, so parallel guesses cannot pass the attempt limit. */
  function verify(passcode: string): Promise<void> {
    const run = queue.then(() => verifyNow(passcode));
    queue = run.catch(() => undefined);
    return run;
  }

  /** Throws on a wrong passcode; repeated failures block every check for a growing delay. */
  async function verifyNow(passcode: string): Promise<void> {
    const row = readRow();
    if (!row) throw new UiLockError("No PIN or password is set.");
    const wait = retryAfterMs();
    if (wait > 0) {
      throw new UiLockError(`Too many wrong attempts. Try again in ${Math.ceil(wait / 1000)} s.`);
    }
    const expected = Buffer.from(row.hash, "base64");
    const actual = await derive(passcode, Buffer.from(row.salt, "base64"));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      saveAttempts(0, 0);
      return;
    }
    const failures = attempts().failures + 1;
    saveAttempts(failures, 0);
    const what = row.kind === "pin" ? "PIN" : "password";
    const { maxAttempts, lockoutMs } = config();
    if (failures >= maxAttempts) {
      saveAttempts(failures, now() + Math.min(lockoutMs * 2 ** (failures - maxAttempts), MAX_DELAY_MS));
      throw new UiLockError(`Wrong ${what}. Too many wrong attempts: try again in ${Math.ceil(retryAfterMs() / 1000)} s.`);
    }
    const left = maxAttempts - failures;
    throw new UiLockError(`Wrong ${what}. ${left} ${left === 1 ? "attempt" : "attempts"} left.`);
  }

  async function writePasscode(kind: LockKind, passcode: string): Promise<void> {
    const salt = randomBytes(16);
    const hash = await derive(passcode, salt);
    db.prepare(
      `INSERT INTO env_ui_lock (id, kind, hash, salt, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, hash = excluded.hash, salt = excluded.salt,
         updated_at = excluded.updated_at`,
    ).run(kind, hash.toString("base64"), salt.toString("base64"), new Date(now()).toISOString());
  }

  function clear(): void {
    db.prepare("DELETE FROM env_ui_lock WHERE id = 1").run();
    sessions.clear();
    saveAttempts(0, 0);
  }

  return {
    /** A live session also moves its idle expiry forward: the page calls this as a keepalive. */
    status(token: string | null): UiLockStatus {
      const row = readRow();
      const { kind: newKind, autoLockMs } = config();
      return {
        enabled: row !== undefined,
        unlocked: row === undefined || keepAlive(token),
        retryAfterMs: row ? retryAfterMs() : 0,
        kind: row?.kind ?? newKind,
        newKind,
        autoLockMs,
      };
    },

    /** Gate for page RPCs. A valid call moves the idle expiry forward. */
    requireUnlocked(token: string | null): void {
      if (!enabled()) return;
      if (!keepAlive(token)) throw new UiLockError(LOCKED_MESSAGE);
    },

    async unlock(passcode: string): Promise<string> {
      await verify(passcode);
      return openSession();
    },

    lock(token: string | null): void {
      if (token) sessions.delete(token);
    },

    /**
     * Sets or changes the passcode, of the kind the settings name. Changing it needs the current
     * one and ends every other session.
     */
    async setPasscode(current: string | null, next: string): Promise<string> {
      const { kind } = config();
      const problem = passcodeProblemText(kind, next);
      if (problem) throw new UiLockError(problem);
      if (enabled()) await verify(current ?? "");
      await writePasscode(kind, next);
      sessions.clear();
      return openSession();
    },

    async disable(current: string): Promise<void> {
      await verify(current);
      clear();
    },

    /** Recovery from a shell on the host: the CLI can already read every entry. */
    reset(): boolean {
      const was = enabled();
      clear();
      return was;
    },
  };
}

export type UiLock = ReturnType<typeof createUiLock>;
