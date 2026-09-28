---
title: Env Catalog — Project Facts
updated: 2026-09-28
sources:
  - package.json
  - server.ts
  - app.tsx
  - contracts.ts
  - kinds.ts
  - i18n.ts
  - docs/overview.md
  - docs/architecture.md
  - docs/gotchas.md
---

# Env Catalog — Project Facts

## Identity

- BB plugin package: `bb-plugin-env-catalog`, version `0.3.0` (`package.json:2-7`).
- Server entry: `server.ts`; UI entry: `app.tsx` (`package.json:9-18`).
- Plugin SDK minimum: BB `>=0.43`, SDK `>=0.4.87` (`package.json:5-7`).
- Purpose and user surfaces: [overview](docs/overview.md).

## Entry points

- `server.ts`: plugin initialization, SQLite table, RPC handlers, agent tools, CLI, and agent instructions (`server.ts:152-212`, `server.ts:562-599`, `server.ts:601-1087`; [architecture](docs/architecture.md), [API](docs/api.md)).
- `app.tsx`: BB navigation page and pending-interaction renderer (`app.tsx:1030-1042`; [catalog management](docs/features/catalog-management.md), [secure requests](docs/features/secure-requests.md)).
- `contracts.ts`, `kinds.ts`: request schemas, credential kinds, structured access validation and packing (`contracts.ts:4-70`, `kinds.ts:3-103`; [data model](docs/data-model.md)).
- `i18n.ts`: English/Russian UI dictionary and selection from BB's document language (`i18n.ts:1-4`, `i18n.ts:83-86`, `i18n.ts:167-182`; [catalog management](docs/features/catalog-management.md)).
- `skills/env-catalog/SKILL.md`: agent-facing usage guidance.

## Critical invariants

- The SQLite primary key is credential `name`; saving the same name replaces its row and preserves `created_at` (`server.ts:202-210`, `server.ts:327-350`; [data model](docs/data-model.md)).
- Values in `encrypted_value` use AES-256-GCM; the plugin master key is a separate file under the BB data directory (`server.ts:155-196`; [data model](docs/data-model.md)).
- Credential kinds are `secret`, `ftp`, `ssh`, and `login`; structured forms are validated before packing (`kinds.ts:3-6`, `kinds.ts:57-103`; [catalog management](docs/features/catalog-management.md)).
- A bad-length master-key file is replaced with a fresh random key; existing encrypted values then cannot be decrypted (`server.ts:162-172`, `server.ts:184-196`; [gotchas](docs/gotchas.md)).

## Conventions

- Product behavior and limits live on their owning feature or reference page; start at [documentation overview](docs/overview.md).
- UI and server payload schemas use `contracts.ts` and `rpcContract` in `server.ts` (`contracts.ts:22-70`, `server.ts:56-128`; [API](docs/api.md)).
- `npm run typecheck`, `npm run build`, and `npm run check` are defined in `package.json:68-72` ([deployment](docs/deployment.md)).

## Common gotchas

- `.env` import saves each assignment as kind `secret`; JSON import passes each item's `kind` and `access` to the save path, preserving structured credentials (`server.ts:414-434`, `server.ts:476-480`; [gotchas](docs/gotchas.md)).
- Secure request name validation is stricter than ordinary saves (`contracts.ts:4-18`, `server.ts:81-89`; [gotchas](docs/gotchas.md)).
- `env_request` and CLI `request` require an active BB thread (`server.ts:902-909`, `server.ts:1192-1205`; [secure requests](docs/features/secure-requests.md)).

## Useful commands

- `npm ci` — install locked dependencies.
- `npm run typecheck` — run TypeScript without emitting files (`package.json:68-72`).
- `npm run build` — build the plugin through `bb plugin build` (`package.json:68-72`).
- `npm run check` — typecheck then build (`package.json:68-72`).
- `bb env-catalog …` — catalog command group; command reference in [API](docs/api.md).

## Where to look next

- [README](README.md) — human front page.
- [Deployment](docs/deployment.md) — dependency installation, build, checks, and BB installation boundary.
- [API](docs/api.md) — RPC operations, agent tools, and CLI.
- [Data model](docs/data-model.md) — persisted fields and ownership.
