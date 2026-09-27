---
title: Env Catalog — Project Facts
updated: 2026-09-27
sources:
  - package.json
  - server.ts
  - app.tsx
  - docs/overview.md
  - docs/architecture.md
  - docs/gotchas.md
---

# Env Catalog — Project Facts

## Identity

- BB plugin package: `bb-plugin-env-catalog`, version `0.3.0` (`package.json`).
- Server entry: `server.ts`; UI entry: `app.tsx` (`package.json`).
- Plugin SDK minimum: BB `>=0.43`, SDK `>=0.4.87` (`package.json`).
- Purpose and user surfaces: [overview](docs/overview.md).

## Entry points

- `server.ts`: plugin initialization, SQLite table, RPC handlers, agent tools, CLI, and agent instructions ([architecture](docs/architecture.md), [API](docs/api.md)).
- `app.tsx`: BB navigation page and pending-interaction renderer ([catalog management](docs/features/catalog-management.md), [secure requests](docs/features/secure-requests.md)).
- `contracts.ts`, `kinds.ts`: request schemas, credential kinds, structured access validation and packing ([data model](docs/data-model.md)).
- `skills/env-catalog/SKILL.md`: agent-facing usage guidance.

## Critical invariants

- The SQLite primary key is credential `name`; saving the same name replaces its row and preserves `created_at` ([data model](docs/data-model.md)).
- Values in `encrypted_value` use AES-256-GCM; the plugin master key is a separate file under the BB data directory ([data model](docs/data-model.md)).
- Credential kinds are `secret`, `ftp`, `ssh`, and `login`; structured forms are validated before packing ([catalog management](docs/features/catalog-management.md)).
- A bad-length master-key file is replaced with a fresh random key; existing encrypted values then cannot be decrypted ([gotchas](docs/gotchas.md)).

## Conventions

- Keep product behavior and limits on their owning feature or reference page; start at [documentation overview](docs/overview.md).
- Keep UI and server payload schemas aligned through `contracts.ts` and `rpcContract` in `server.ts` ([API](docs/api.md)).
- Use `npm run typecheck`, `npm run build`, or `npm run check` as defined by `package.json` ([deployment](docs/deployment.md)).

## Common gotchas

- `.env` import stores values as `secret`; structured credentials require JSON import ([gotchas](docs/gotchas.md)).
- Secure request name validation is stricter than ordinary saves ([gotchas](docs/gotchas.md)).
- `env_request` and CLI `request` require an active BB thread ([secure requests](docs/features/secure-requests.md)).

## Useful commands

- `npm ci` — install locked dependencies.
- `npm run typecheck` — run TypeScript without emitting files.
- `npm run build` — build the plugin through `bb plugin build`.
- `npm run check` — typecheck then build.
- `bb env-catalog …` — catalog command group; command reference in [API](docs/api.md).

## Where to look next

- [README](README.md) — human front page.
- [Deployment](docs/deployment.md) — dependency installation, build, checks, and BB installation boundary.
- [API](docs/api.md) — RPC operations, agent tools, and CLI.
- [Data model](docs/data-model.md) — persisted fields and ownership.
