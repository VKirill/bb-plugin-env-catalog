import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { JOURNAL_MIGRATIONS, createJournalStore } from "./journal.ts";

function store() {
  const db = new Database(":memory:");
  JOURNAL_MIGRATIONS.forEach((s) => db.exec(s));
  let tick = 0;
  return createJournalStore(db, { now: () => `2026-10-08T00:00:0${tick++}Z` });
}

test("an entry keeps who, where and why, newest first; filter by name", () => {
  const s = store();
  s.addJournal({ name: "A", outcome: "issued", via: "tool", threadId: "thr_1", threadTitle: "T1", projectId: "p1", projectName: "P", purpose: "rent a GPU" });
  s.addJournal({ name: "B", outcome: "saved", via: "cli" });
  s.addJournal({ name: "A", outcome: "deleted", via: "tool", threadId: "thr_2" });
  const all = s.listJournal();
  assert.deepEqual(all.map((e) => e.outcome), ["deleted", "saved", "issued"]);
  assert.equal(all[2].threadTitle, "T1");
  assert.equal(all[2].purpose, "rent a GPU");
  assert.equal(all[1].threadId, null);
  assert.deepEqual(s.listJournal(200, "A").map((e) => e.name), ["A", "A"]);
  assert.equal(s.listJournal(1).length, 1);
});

test("long free text is clipped and blanks become null", () => {
  const s = store();
  s.addJournal({ name: " K ", outcome: "issued", via: "tool", purpose: "x".repeat(900), threadTitle: "   " });
  const [e] = s.listJournal();
  assert.equal(e.name, "K");
  assert.equal(e.purpose?.length, 500);
  assert.equal(e.threadTitle, null);
});
