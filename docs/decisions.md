---
title: Env Catalog Decisions
type: decisions
created: 2026-09-27
updated: 2026-10-01
status: active
confidence: medium
tags: [decisions, credentials, bb-plugin]
sources:
  - server.ts
  - app.tsx
  - contracts.ts
  - kinds.ts
---

# Env Catalog Decisions

TL;DR: The implementation records encrypted plugin-owned credential storage and a BB pending-interaction request path. The source does not record broader trade-off discussions (`server.ts:155-212`, `server.ts:786-859`).

## 001. Encrypt credential payloads in plugin storage

**Context:** The plugin stores API keys and structured credentials in a BB SQLite database (`server.ts:199-212`).

**Decision:** Encrypt the packed credential payload with AES-256-GCM and store the master key separately in the plugin data directory (`server.ts:155-196`, `server.ts:311-350`).

**Status:** Active.

**Consequences:** Database rows do not contain plaintext values; reading values requires the matching 32-byte key. Key replacement prevents decryption of existing rows (`server.ts:162-172`, `server.ts:184-196`).

**Sources:** `server.ts:155-212`, `server.ts:311-350`.

## 002. Collect requested credentials through a BB pending interaction

**Context:** The `env_request` operation must collect values from a user in a thread (`server.ts:861-895`).

**Decision:** Render the `env-catalog-request` UI interaction and pass its typed response to the persistence function (`server.ts:786-859`, `contracts.ts:70`, `app.tsx:894-1028`).

**Status:** Active.

**Consequences:** The request needs an active thread and can return cancelled without saving. The UI and server share response schemas (`server.ts:902-959`, `contracts.ts:52-68`).

**Sources:** `server.ts:786-859`, `server.ts:861-959`, `app.tsx:894-1028`.

## 003. Secret-touching RPC and CLI methods accept only the owner (0.3.1)

**Context:** BB's HTTP API has no login, so an agent could call `env_get_value`, `env_delete`, `env_export` and the others with `curl`; the shell guard cannot see that (audit 2026-10-08 round 3, P0 item 1).

**Decision:** The plugin declares `vk.rpcCallerPolicy` in `package.json`. A VK core then hands `experimental_vkCaller` to the RPC handlers and the CLI context. `env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `env_import_machine_env` and the CLI `get`, `set`, `delete`, `export`, `import-machine-env` run for `owner-ui` and `owner-cli` only; another plugin may call `env_get_value` (Lane Pilot checks, Image Studio keys). `agent-thread` and `unknown` are refused. `env_list`, `request` and the agent tools are unchanged (the tools keep their own role checks). Logic and tests: `lib/rpc-caller.ts`, `lib/rpc-caller.test.ts`.

**Status:** Active.

**Consequences:** On a core without the function the mark is absent and the plugin keeps the old behaviour (it cannot tell the caller). `owner-*` are client-asserted, so a client that forges them on purpose is not stopped; the shell guard and the agent tools' roles stay in place.

**Sources:** `server.ts` (`guardRpc`, `cliGuard`), `lib/rpc-caller.ts`.

## 004. Changing agent tools refuse; `unverified-owner` is a known caller kind (unreleased)

**Context:** Audit 2026-10-08 round 4, P0-6: the tools `env_set` and `env_delete` did not check the caller, so any agent could overwrite or delete a secret. Core is also about to stop trusting the client marks `owner-ui`/`owner-cli` and to report `unverified-owner` for an owner claim it could not verify.

**Decision:** `env_set` and `env_delete` refuse every call (a tool call is an agent call) and point to `env_request` or the Env Catalog page; the refusal runs through `callerRefusal` (`tool_env_set`, `tool_env_delete`). `unverified-owner` is a known kind: every secret RPC and CLI method (`env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `env_import_machine_env`, `cli_*`) refuses it with a message to open the page after the owner signed in. `plugin` keeps `env_get_value`. `env_get`, `env_list`, `env_request` are unchanged.

**Status:** Active.

**Consequences:** An agent can no longer save a credential the owner pasted in chat; it asks through `env_request`. Logic and tests: `lib/rpc-caller.ts`, `lib/rpc-caller.test.ts`.
