---
title: Agent Grants and Issuance Journal
type: component
created: 2026-10-08
updated: 2026-10-08
status: active
confidence: medium
tags: [grants, agent-access, journal]
sources:
  - server.ts
  - lib/grants.ts
  - lib/rpc-caller.ts
  - contracts.ts
  - app.tsx
---

# Agent Grants and Issuance Journal

TL;DR: An agent gets a stored value only when the owner granted that name to its thread or project. With no grant the owner gets a form and the agent's call waits (decision 005).

## Flow

1. The agent calls `env_get {name, purpose?}` or `bb env-catalog get NAME --raw [--purpose text]` (from an agent session).
2. Unknown name: answered at once with `found:false` (no form).
3. A grant for (name, this thread) or (name, this thread's project) exists: value returned, journal row `issued` with the grant kind.
4. No grant: a row in `env_grant_requests` and a BB form (`env-catalog-grant`) in the agent's thread. Title «Выдать NAME треду «…»?», body: project, the agent's purpose, how it asked. Buttons: Один раз, Всегда для этого проекта, Всегда для этого треда, Нет. The owner can also answer in the «Доступ агентов» block of the Env Catalog page; that closes the form and wakes the call.
5. The call waits at most 10 minutes. Outcomes: granted (value), `denied` (message: do not retry, no workaround), `timeout` / dismissed / thread stopped (message: grant NOT given, call again for a new form), `unavailable` (the form could not be posted).

The answer is trusted only when recorded by the owner-only RPC `grant_decide`; the form submit value is never trusted (decision 006).

## Page and RPCs (owner only)

| RPC | Purpose |
| --- | --- |
| `grant_list` `null` | `{grants, pending}` |
| `grant_decide` `{requestId, decision: once\|thread\|project\|deny}` | answer a pending request (the form and the page call it) |
| `grant_create` `{name, scope: thread\|project, scopeId, label?}` | grant in advance; drill and pre-run use |
| `grant_revoke` `{id}` | remove a standing grant |
| `journal_list` `{limit?, name?}` | newest first, max 1000 |

Callers: `owner-ui`, `owner-cli`, and while owner login is off `unverified-owner` with `browser-headers`. Agents and other plugins are refused with an instruction.

## Data

`env_grants(id, name, scope, scope_id, label, granted_at, granted_by)` unique on (name, scope, scope_id); `env_grant_requests(id, name, thread_id, project_id, thread_title, project_name, purpose, source, status, created_at, decided_at, decided_by, consumed_at)`; `env_issuance_journal(id, at, name, outcome, via, grant_kind, thread_id, thread_title, project_id, project_name, purpose, caller)`. No value in any of them. Pending requests are closed on plugin start.

## Drill / sandbox check

With a sandbox thread `thr_X` in project `proj_Y` and a stored `NAME`: (1) the thread calls `env_get {name:"NAME"}`: the call blocks; (2) as owner `bb plugin rpc call env-catalog grant_list` shows the pending id; (3) `grant_decide {requestId, decision:"once"}` (or `grant_create {name, scope:"project", scopeId:"proj_Y"}` before step 1 for an instant answer); (4) the call returns `granted:true`; (5) `journal_list {name:"NAME"}` shows the row and no value. Without step 3 the call returns `granted:false` after the timeout.
