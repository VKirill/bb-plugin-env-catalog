import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { GRANT_MIGRATIONS, createGrantStore } from "./grants.ts";

function store() {
  const db = new Database(":memory:");
  GRANT_MIGRATIONS.forEach((s) => db.exec(s));
  return createGrantStore(db);
}

test("a thread grant covers only that thread; a project grant covers every thread of the project", () => {
  const s = store();
  s.addGrant({ name: "K", scope: "thread", scopeId: "thr_1" });
  assert.ok(s.findGrant("K", "thr_1", "p1"));
  assert.equal(s.findGrant("K", "thr_2", "p1"), null);
  s.addGrant({ name: "K", scope: "project", scopeId: "p1" });
  assert.equal(s.findGrant("K", "thr_2", "p1")?.scope, "project");
  assert.equal(s.findGrant("K", "thr_2", "p2"), null);
  assert.equal(s.findGrant("OTHER", "thr_1", "p1"), null);
  assert.equal(s.findGrant("K", "thr_2", null), null);
});

test("only a pending request can be decided; the first answer stands", () => {
  const s = store();
  const r = s.createRequest({ name: "K", threadId: "thr_1", projectId: "p1" });
  assert.equal(s.decideRequest(r.id, "deny", "owner")?.status, "deny");
  assert.equal(s.decideRequest(r.id, "project", "owner")?.status, "deny");
  assert.equal(s.listGrants().length, 0);
  assert.equal(s.decideRequest("missing", "once", "owner"), null);
});

test("Always for this project without a project id becomes a one-time answer", () => {
  const s = store();
  const r = s.createRequest({ name: "K", threadId: "thr_1" });
  assert.equal(s.decideRequest(r.id, "project", "owner")?.status, "once");
  assert.equal(s.listGrants().length, 0);
});

test("a one-time answer is spent by exactly one reader", () => {
  const s = store();
  const r = s.createRequest({ name: "K", threadId: "thr_1", projectId: "p1" });
  s.decideRequest(r.id, "once", "owner");
  assert.equal(s.consumeOnce(r.id), true);
  assert.equal(s.consumeOnce(r.id), false);
});

test("an expired request cannot be answered late, and restart expires what was pending", () => {
  const s = store();
  const a = s.createRequest({ name: "K", threadId: "thr_1", projectId: "p1" });
  s.expireRequest(a.id);
  assert.equal(s.decideRequest(a.id, "thread", "owner")?.status, "expired");
  assert.equal(s.listGrants().length, 0);
  s.createRequest({ name: "K", threadId: "thr_2", projectId: "p1" });
  assert.equal(s.expireAllPending(), 1);
  assert.equal(s.listPendingRequests().length, 0);
});

test("the journal keeps ids and names, newest first", () => {
  const s = store();
  s.addJournal({ name: "K", outcome: "issued", via: "tool", grantKind: "once", threadId: "thr_1" });
  s.addJournal({ name: "K", outcome: "denied", via: "cli", threadId: "thr_2" });
  const rows = s.listJournal(10);
  assert.equal(rows[0].outcome, "denied");
  assert.equal(rows[1].grantKind, "once");
  assert.equal(s.listJournal(10, "OTHER").length, 0);
});
