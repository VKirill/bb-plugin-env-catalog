import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  LOCKED_MESSAGE,
  UI_LOCK_MIGRATIONS,
  createUiLock,
  parseLockConfig,
  type LockConfig,
} from "./ui-lock.ts";

const SESSION_IDLE_MS = 5 * 60_000;

function setup(settings: Record<string, unknown> = { lockType: "password" }) {
  const db = new Database(":memory:");
  UI_LOCK_MIGRATIONS.forEach((s) => db.exec(s));
  const clock = { t: 1_000_000 };
  const cfg: { value: LockConfig } = { value: parseLockConfig({ lockoutMinutes: 0.5, ...settings }) };
  cfg.value.lockoutMs = 30_000;
  const lock = createUiLock(db, () => cfg.value, () => clock.t);
  return { db, clock, lock, cfg };
}

test("with no passcode the page is open and needs no token", () => {
  const { lock } = setup();
  assert.deepEqual(lock.status(null), {
    enabled: false,
    unlocked: true,
    retryAfterMs: 0,
    kind: "password",
    newKind: "password",
    autoLockMs: SESSION_IDLE_MS,
  });
  lock.requireUnlocked(null);
});

test("a set passcode locks every call without a live token; unlock opens a session", async () => {
  const { lock } = setup();
  const first = await lock.setPasscode(null, "48214821");
  assert.throws(() => lock.requireUnlocked(null), { message: LOCKED_MESSAGE });
  assert.throws(() => lock.requireUnlocked("forged"), { message: LOCKED_MESSAGE });
  lock.requireUnlocked(first);

  await assert.rejects(lock.unlock("00000000"), /Wrong password/);
  const token = await lock.unlock("48214821");
  lock.requireUnlocked(token);
  assert.equal(lock.status(token).unlocked, true);
  assert.equal(lock.status(null).unlocked, false);

  lock.lock(token);
  assert.throws(() => lock.requireUnlocked(token), { message: LOCKED_MESSAGE });
});

test("the database keeps a salted hash, never the passcode", async () => {
  const { db, lock } = setup();
  await lock.setPasscode(null, "correct horse");
  const row = db.prepare("SELECT * FROM env_ui_lock").get() as Record<string, string>;
  assert.ok(!JSON.stringify(row).includes("correct horse"));
  assert.equal(Buffer.from(row.hash, "base64").length, 64);
});

test("a session ends after the idle time and each call moves the expiry forward", async () => {
  const { lock, clock } = setup();
  const token = await lock.setPasscode(null, "48214821");
  clock.t += SESSION_IDLE_MS - 1000;
  lock.requireUnlocked(token);
  clock.t += SESSION_IDLE_MS - 1000;
  lock.requireUnlocked(token);
  clock.t += SESSION_IDLE_MS;
  assert.throws(() => lock.requireUnlocked(token), { message: LOCKED_MESSAGE });
});

test("five wrong attempts block even the right passcode until the delay ends", async () => {
  const { lock, clock } = setup();
  await lock.setPasscode(null, "48214821");
  for (let i = 0; i < 5; i++) await assert.rejects(lock.unlock("11111111"), /Wrong/);
  assert.equal(lock.status(null).retryAfterMs, 30_000);
  await assert.rejects(lock.unlock("48214821"), /Too many wrong attempts/);
  clock.t += 30_000;
  await lock.unlock("48214821");
  assert.equal(lock.status(null).retryAfterMs, 0);
});

test("parallel guesses are checked one at a time and cannot pass the limit", async () => {
  const { lock } = setup();
  await lock.setPasscode(null, "48214821");
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => lock.unlock("11111111")));
  const messages = results.map((r) => (r.status === "rejected" ? (r.reason as Error).message : "ok"));
  assert.equal(messages.filter((m) => m.startsWith("Wrong")).length, 5);
  assert.equal(messages.filter((m) => m.startsWith("Too many")).length, 3);
});

test("changing the passcode needs the current one and ends the other sessions", async () => {
  const { lock } = setup();
  await lock.setPasscode(null, "48214821");
  const old = await lock.unlock("48214821");
  await assert.rejects(lock.setPasscode(null, "99999999"), /Wrong/);
  await assert.rejects(lock.setPasscode("12341234", "99999999"), /Wrong/);
  const fresh = await lock.setPasscode("48214821", "new password");
  assert.throws(() => lock.requireUnlocked(old), { message: LOCKED_MESSAGE });
  lock.requireUnlocked(fresh);
  await assert.rejects(lock.unlock("48214821"), /Wrong/);
  await lock.unlock("new password");
});

test("too short or too long passwords are refused", async () => {
  const { lock } = setup();
  await assert.rejects(lock.setPasscode(null, "12345"), /6 to 128 characters/);
  await assert.rejects(lock.setPasscode(null, "x".repeat(129)), /6 to 128 characters/);
  assert.equal(lock.status(null).enabled, false);
});

test("a PIN is 4 to 12 digits and keeps its kind when the setting changes", async () => {
  const { lock, cfg } = setup({ lockType: "pin" });
  await assert.rejects(lock.setPasscode(null, "12a4"), /4 to 12 digits/);
  await assert.rejects(lock.setPasscode(null, "123"), /4 to 12 digits/);
  await assert.rejects(lock.setPasscode(null, "1234567890123"), /4 to 12 digits/);
  await lock.setPasscode(null, "0042");
  cfg.value = { ...cfg.value, kind: "password" };
  const status = lock.status(null);
  assert.equal(status.kind, "pin");
  assert.equal(status.newKind, "password");
  await lock.unlock("0042");
});

test("the settings set the attempts before lockout, the lockout, and the idle time", async () => {
  const { lock, clock, cfg } = setup({ lockType: "pin" });
  cfg.value = parseLockConfig({ lockType: "pin", maxAttempts: 3, lockoutMinutes: 2, autoLockMinutes: 1 });
  const token = await lock.setPasscode(null, "4821");
  await assert.rejects(lock.unlock("0000"), /2 attempts left/);
  await assert.rejects(lock.unlock("0000"), /1 attempt left/);
  await assert.rejects(lock.unlock("0000"), /try again in 120 s/);
  assert.equal(lock.status(null).retryAfterMs, 120_000);
  clock.t += 120_000;
  await assert.rejects(lock.unlock("0000"), /try again in 240 s/);
  clock.t += 240_000;
  await lock.unlock("4821");
  clock.t += 60_000;
  assert.throws(() => lock.requireUnlocked(token), { message: LOCKED_MESSAGE });
});

test("out-of-range settings are clamped, so guessing stays slow", () => {
  assert.deepEqual(parseLockConfig({ lockType: "x", maxAttempts: 1000, lockoutMinutes: 0, autoLockMinutes: 9999 }), {
    kind: "pin",
    autoLockMs: 120 * 60_000,
    maxAttempts: 10,
    lockoutMs: 60_000,
  });
  assert.deepEqual(parseLockConfig({}), { kind: "pin", autoLockMs: 5 * 60_000, maxAttempts: 5, lockoutMs: 60_000 });
});

test("disable needs the passcode; reset removes it without one", async () => {
  const { lock } = setup();
  await lock.setPasscode(null, "48214821");
  await assert.rejects(lock.disable("00000000"), /Wrong/);
  await lock.disable("48214821");
  assert.equal(lock.status(null).enabled, false);
  lock.requireUnlocked(null);

  await lock.setPasscode(null, "48214821");
  assert.equal(lock.reset(), true);
  assert.equal(lock.reset(), false);
  lock.requireUnlocked(null);
});

test("a status check with a live token is a keepalive; without one it changes nothing", async () => {
  const { lock, clock } = setup();
  const token = await lock.setPasscode(null, "48214821");
  clock.t += SESSION_IDLE_MS - 1000;
  assert.equal(lock.status(token).unlocked, true);
  clock.t += SESSION_IDLE_MS - 1000;
  lock.requireUnlocked(token);
  clock.t += SESSION_IDLE_MS;
  assert.equal(lock.status(token).unlocked, false);
});

test("the attempt count and lockout survive a plugin reload", async () => {
  const { db, lock, clock, cfg } = setup({ lockType: "pin" });
  await lock.setPasscode(null, "4821");
  for (let i = 0; i < 5; i++) await assert.rejects(lock.unlock("0000"), /Wrong/);
  const reloaded = createUiLock(db, () => cfg.value, () => clock.t);
  assert.equal(reloaded.status(null).retryAfterMs, 30_000);
  await assert.rejects(reloaded.unlock("4821"), /Too many wrong attempts/);
  clock.t += 30_000;
  await assert.rejects(reloaded.unlock("0000"), /try again in 60 s/);
});
