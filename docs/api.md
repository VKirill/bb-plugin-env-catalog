---
title: Env Catalog API and Commands
type: component
created: 2026-09-27
updated: 2026-10-01
status: active
confidence: medium
tags: [api, rpc, cli, agent-tools]
sources:
  - server.ts
  - contracts.ts
  - app.tsx
  - skills/env-catalog/SKILL.md
  - kinds.ts
---

# Env Catalog API and Commands

TL;DR: The plugin exposes seven BB RPC operations, five BB agent tools, and seven CLI commands. `env_delete` is an RPC operation, while `bb env-catalog request` is a CLI command; neither is an HTTP route (`server.ts:56-128`, `server.ts:562-959`, `server.ts:1046-1087`).

## Purpose

This page catalogs the plugin's callable interfaces. The source registers BB RPC handlers, agent tools, and CLI commands, but no HTTP route. The `env_delete` RPC operation and the CLI `request` command are BB interfaces, not HTTP paths (`server.ts:562-599`, `server.ts:601-959`, `server.ts:1046-1087`).

## How it works

1. `rpcContract` declares input and output schemas for seven UI operations (`server.ts:56-128`).
2. The server registers handlers for those operations (`server.ts:562-599`).
3. The React app calls RPC through `useRpc` and subscribes to `env-catalog:changed` events (`app.tsx:366-394`).
4. The server separately registers agent tools and a CLI command group (`server.ts:601-959`, `server.ts:1046-1087`).

### Plugin initialization (`plugin`)

1. BB calls the default-exported async `plugin` function. It logs startup, chooses `bb.server.experimental_dataDir` when set or falls back to `$HOME/.bb` (using `~/.bb` when `HOME` is unset), then creates the `plugins/env-catalog` directory recursively (`server.ts:152-160`).
2. It reads `master.key` if present. Exactly 32 bytes are reused; a different length is replaced with 32 random bytes. If the file is absent, a new 32-byte key is generated. Both write paths request mode `0600` (`server.ts:162-173`).
3. The nested `encrypt` function stores AES-256-GCM output as base64 IV, authentication tag, and ciphertext separated by colons. `decrypt` returns values unchanged when they do not have three colon-separated parts; otherwise it decrypts with the loaded key (`server.ts:175-196`).
4. The server obtains BB's plugin database and migrates the `env_variables` table plus the `service` index (`server.ts:199-212`).
5. It inspects the table columns and adds `kind TEXT NOT NULL DEFAULT 'secret'` only when that column is missing (`server.ts:214-221`).

| Initialization branch | Condition | Outcome | Failure behavior |
|---|---|---|---|
| Data directory | BB supplies `experimental_dataDir`, or it is absent. | Uses the supplied directory, or the home-directory fallback, then creates `plugins/env-catalog` (`server.ts:155-160`). | Directory creation errors escape initialization; there is no local catch in this path (`server.ts:152-160`). |
| Master key | `master.key` exists and has 32 bytes. | Reads and reuses that key (`server.ts:162-166`). | File read errors escape initialization (`server.ts:162-166`). |
| Master key | File is absent or has a length other than 32 bytes. | Generates a 32-byte key and writes it with requested mode `0600` (`server.ts:166-173`). | Write errors escape initialization. Replacing a malformed key leaves existing ciphertext without its former key (`server.ts:166-173`, `server.ts:184-196`). |
| `kind` column | Column is present or absent after the table migration. | Leaves it intact when present; otherwise adds it with default `secret` for existing rows (`server.ts:214-221`). | Database inspection or alteration errors escape initialization (`server.ts:214-221`). |

The directory, key-file, database, and migration operations have no startup-level catch, so their thrown errors reject `plugin` initialization (`server.ts:152-221`).

### `rpcContract` branches, outcomes, and failures

The contract assigns a Zod input and output shape to each RPC name. Optional filters and save metadata accept omitted or null values where declared; the handler for each name supplies its result (`server.ts:56-128`, `server.ts:562-599`).

| RPC branch | Conditions or modes | Outcome and failure behavior |
|---|---|---|
| `env_list` | `query` and `kind` are each optional and nullable. | Returns `variables`, an array of summaries; server search may filter by text and kind (`server.ts:57-65`, `server.ts:244-308`, `server.ts:562-565`). |
| `env_get_value` | Requires a string `name`. | Returns name, kind, value/access, reveal text, and metadata; a missing name throws a not-found error (`server.ts:66-80`, `server.ts:566-580`). |
| `env_save` | Requires a trimmed non-empty name; kind, value, access, description, service, and tags are optional/nullable. | Saves or replaces the named record and returns success/name. Empty credential values or invalid structured access fail in the save path (`server.ts:81-95`, `server.ts:311-350`, `kinds.ts:57-103`). |
| `env_delete` | Requires a string `name`. | Returns `success: true` if a row was deleted and `false` if no row matched; missing rows do not throw (`server.ts:96-103`, `server.ts:355-363`, `server.ts:586-589`). |
| `env_export` | `format` must be `env` or `json`. | Returns serialized content. If AES-GCM decryption throws, `exportAll` and the RPC handler do not catch the exception (`server.ts:184-196`, `server.ts:366-405`, `server.ts:590-592`). |
| `env_import` | Requires content and format `env` or `json`; `overwrite` defaults to `true`. | Returns imported count. Invalid JSON throws an invalid-format error; unsupported or invalid rows are skipped according to the import path (`server.ts:112-120`, `server.ts:408-491`, `server.ts:593-595`). |
| `env_import_machine_env` | Input is `null`. | Returns imported count; missing source files or an invalid key encoding yield zero, and individual decryption failures are logged and skipped (`server.ts:122-127`, `server.ts:493-559`, `server.ts:596-598`). |

Zod rejects payloads that do not match an operation's declared shape. Errors raised by a handler, such as a missing record in `env_get_value`, are returned as RPC failures (`server.ts:56-128`, `server.ts:566-599`).

### RPC operations

| Method | Path / operation | Caller | Purpose | Auth |
|---|---|---|---|---|
| `env_list` | RPC `env_list` | Plugin UI | Search by query and optional kind; returns masked summaries. | BB RPC host context; no plugin-specific user check in handler (`server.ts:56-65`, `server.ts:562-565`). |
| `env_get_value` | RPC `env_get_value` | Plugin UI | Return full record for reveal or edit. | BB RPC host context; no plugin-specific user check in handler (`server.ts:66-80`, `server.ts:566-580`). |
| `env_save` | RPC `env_save` | Plugin UI | Create or replace a record. | BB RPC host context; no plugin-specific user check in handler (`server.ts:81-95`, `server.ts:582-585`). |
| `env_delete` | RPC `env_delete` | Plugin UI | Delete by name. | BB RPC host context; no plugin-specific user check in handler (`server.ts:96-103`, `server.ts:586-589`). |
| `env_export` | RPC `env_export` | Plugin UI | Export all rows as `env` or `json`. | BB RPC host context; no plugin-specific user check in handler (`server.ts:104-111`, `server.ts:590-592`). |
| `env_import` | RPC `env_import` | Plugin UI | Import `env` or `json` content; overwrite defaults to true. | BB RPC host context; no plugin-specific user check in handler (`server.ts:112-120`, `server.ts:593-595`). |
| `env_import_machine_env` | RPC `env_import_machine_env` | Plugin UI | Import values from BB Machine Environment. | BB RPC host context; no plugin-specific user check in handler (`server.ts:122-127`, `server.ts:596-598`). |

### Agent tools

| Method | Path / tool | Caller | Purpose | Auth |
|---|---|---|---|---|
| `env_list` | Agent tool `env_list` | BB agent | List masked summaries, optionally filtered. | BB agent tool runtime; plugin defines no additional permission predicate (`server.ts:636-667`). |
| `env_get` | Agent tool `env_get` | BB agent | Retrieve decrypted secret or structured access by exact name. | BB agent tool runtime; plugin defines no additional permission predicate (`server.ts:602-634`). |
| `env_set` | Agent tool `env_set` | BB agent | Save secret or structured access. | BB agent tool runtime; plugin defines no additional permission predicate (`server.ts:669-752`). |
| `env_delete` | Agent tool `env_delete` | BB agent | Delete a named record. | BB agent tool runtime; plugin defines no additional permission predicate (`server.ts:754-785`). |
| `env_request` | Agent tool `env_request` | BB agent in active thread | Open a secure request form and save its completed response. | BB agent tool runtime plus required thread context (`server.ts:861-959`). |

### CLI commands

| Method | Path / command | Caller | Purpose | Auth |
|---|---|---|---|---|
| `list` | `bb env-catalog list` | BB CLI user or script | List records; supports query, kind, JSON output. | BB CLI registration; no plugin-specific user check (`server.ts:1051-1054`, `server.ts:1104-1140`). |
| `get` | `bb env-catalog get <NAME>` | BB CLI user or script | Read a record; `--raw` outputs its secret value. | BB CLI registration; no plugin-specific user check (`server.ts:1055-1059`, `server.ts:1141-1152`). |
| `set` | `bb env-catalog set <NAME> …` | BB CLI user or script | Create or replace secret or structured access. | BB CLI registration; no plugin-specific user check (`server.ts:1060-1065`, `server.ts:1153-1190`). |
| `request` | `bb env-catalog request <NAME...>` | BB CLI user in active or selected thread | Ask for credentials using the BB form. | BB CLI registration; requires thread context (`server.ts:1067-1071`, `server.ts:1192-1231`). |
| `delete` | `bb env-catalog delete <NAME>` | BB CLI user or script | Remove a record. | BB CLI registration; no plugin-specific user check (`server.ts:1073-1075`, `server.ts:1234-1240`). |
| `export` | `bb env-catalog export` | BB CLI user or script | Write `env` or JSON content to stdout. | BB CLI registration; no plugin-specific user check (`server.ts:1078-1080`, `server.ts:1242-1249`). |
| `import-machine-env` | `bb env-catalog import-machine-env` | BB CLI user or script | Copy/decrypt BB Machine Environment values into the catalog. | BB CLI registration; no plugin-specific user check (`server.ts:1083-1085`, `server.ts:1252-1258`). |

## Business rules

- The plugin source contains no HTTP router or HTTP route registration; these APIs are BB SDK interfaces (`server.ts:4-7`, `server.ts:562-599`, `server.ts:1046-1087`).
- `env_get` returns decrypted values, whereas `env_list` returns masked summaries (`server.ts:602-667`).
- The secure request CLI command needs the current thread ID, `BB_THREAD_ID`, or explicit `--thread` (`server.ts:1192-1205`).
- Save and delete operations publish change notifications consumed by the UI (`server.ts:352-362`, `app.tsx:388-394`).

## Failures

Schema validation errors reject invalid RPC inputs before a handler runs (`server.ts:56-128`). Missing RPC records throw from `env_get_value`; agent `env_get` instead returns `found: false` (`server.ts:566-570`, `server.ts:615-623`). CLI errors return exit code 1 and stderr (`server.ts:1099-1102`). See [Gotchas](gotchas.md) and the [request flow](features/secure-requests.md).

## Gotchas

- RPC operation identifiers are not URL paths; consumers call the BB plugin RPC layer (`server.ts:562-599`).
- `get` and `env_get` expose decrypted values to their callers; `list` omits them (`server.ts:602-667`, `server.ts:1141-1152`).
- There is no CLI file-import command; `env_import` is available through UI RPC, while CLI supports machine-environment import (`server.ts:1046-1087`).

See [catalog management](features/catalog-management.md), [agent access](features/agent-access.md), and [import/export](features/import-export.md) for capability behavior.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Agent Access to Credentials](features/agent-access.md)
- [Credential Catalog Management](features/catalog-management.md)
- [Credential Import and Export](features/import-export.md)
- [Secure Credential Requests](features/secure-requests.md)
- [Env Catalog Overview](overview.md)
