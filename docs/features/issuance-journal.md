---
title: Issuance Journal
type: component
created: 2026-10-08
updated: 2026-10-08
status: active
confidence: medium
tags: [journal, agent-access]
sources:
  - server.ts
  - lib/journal.ts
  - app.tsx
---

# Issuance Journal («Журнал выдачи»)

TL;DR: Agents read, save and delete entries at once; the journal is the passive trace. It never blocks anything and never holds a value (decision 007; the 0.3.2 grant flow is gone).

## What is recorded

One row per agent action: `env_get` tool and `bb env-catalog get` (`issued`), `env_set` / `bb env-catalog set` (`saved`), `env_delete` / `bb env-catalog delete` (`deleted`). Columns: time, name, outcome, how (`tool` / `cli`), thread id and title, project id and name, the agent's optional `purpose`. A row is written in the background after the call returned, so a slow thread lookup never delays the value. An unknown name writes nothing.

Not recorded: the owner's page (`env_get_value`, `env_save`, ...) and another plugin's `env_get_value` call. Stock BB does not tell the plugin who is calling an RPC, so those cannot be told from each other.

## Page and RPC

The Env Catalog page shows the last 50 rows under «Журнал выдачи» and refreshes on every catalog change. RPC `journal_list {limit?, name?}` returns newest first, at most 1000 rows. 0.3.2 rows keep their old outcomes (`denied`, `timeout`, `cancelled`) and the page shows them as before.

## Data

`env_issuance_journal(id, at, name, outcome, via, grant_kind, thread_id, thread_title, project_id, project_name, purpose, caller)`. `grant_kind` and `caller` are unused since 0.3.3 (kept so the shipped migration stays unchanged). `env_grants` and `env_grant_requests` stay in the database empty and unused for the same reason: the host hashes each shipped migration statement.
