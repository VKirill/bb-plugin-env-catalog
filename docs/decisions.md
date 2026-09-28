---
title: Env Catalog Decisions
type: decisions
created: 2026-09-27
updated: 2026-09-28
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
