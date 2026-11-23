---
title: Credential Import and Export
type: component
created: 2026-09-27
updated: 2026-10-01
status: active
confidence: medium
tags: [credentials, import, export]
sources:
  - server.ts
  - app.tsx
  - kinds.ts
  - contracts.ts
---

# Credential Import and Export

TL;DR: The page and CLI export the full catalog as JSON or `.env` text, import either format (`server.ts:366-559`, `app.tsx:426-435`, `app.tsx:519-547`).

## Purpose

Import/export moves catalog records between Env Catalog and files. The plugin never reads BB's own database: values in BB Machine Environment are secret by design and the SDK does not return them, so they are re-entered here instead.ts:493-559`).

## How it works

1. Export selects all catalog rows in name order, decrypts each value, and restores structured credential fields (`server.ts:366-382`).
2. JSON export returns those records as an array; `env` export writes `NAME=value` lines and optional comment metadata (`server.ts:384-405`).
3. Import in the page selects JSON when trimmed content starts with `[`; otherwise it selects `env`, and calls `env_import` with overwrite enabled (`app.tsx:529-547`).
4. JSON import accepts an array of named items, skips non-string values for secret-kind entries, and saves recognized items (`server.ts:408-441`).
5. `env` import treats each assignment as a secret value; preceding `#` lines become description text (`server.ts:442-485`).
7. A positive import count publishes a realtime event so the page refreshes (`server.ts:487-490`, `server.ts:549-554`, `app.tsx:426-435`).

### Modes

| Mode | Input / output | Behavior |
|---|---|---|
| JSON | Array of objects with `name`, `kind`, and `value` or `access`. | Preserves structured access and optional description/service/tags; malformed JSON returns an invalid-format error (`server.ts:408-441`). |
| `.env` | `KEY=value` lines with optional `#` comment lines. | Imports each value as kind `secret`; `overwrite=false` skips existing names (`server.ts:442-485`). |

### Failures

- Invalid JSON syntax throws an `Invalid JSON format` error (`server.ts:414-441`).
- JSON items without a string name are ignored; secret items without a string `value` are skipped (`server.ts:418-426`).
- `.env` lines without a non-empty key before `=` are ignored; a quote pair around a value is stripped, without shell parsing (`server.ts:446-467`).

## Business rules

- Import overwrite defaults to `true` in the RPC schema and the page explicitly sends `true` (`server.ts:112-120`, `app.tsx:535-539`).
- CLI export defaults to `env`; `--format json` selects JSON (`server.ts:1242-1248`).
- Machine-environment import saves records as secrets and uses inferred service and note metadata (`server.ts:534-543`).
- Export includes decrypted values, so exported content is sensitive even though database values are encrypted (`server.ts:366-405`).

## Public API

| Operation | Definition | Purpose |
|---|---|---|
| `env_export` | `server.ts:104-111`, `server.ts:590-592` | Export the catalog as `env` or `json`. |
| `env_import` | `server.ts:112-120`, `server.ts:593-595` | Import content and optionally preserve existing rows. |
| CLI `export` | `server.ts:1078-1085`, `server.ts:1242-1258` | Write exported content. |

See [API](../api.md) for all interfaces and [Data model](../data-model.md) for persistence fields.

## Gotchas

- `.env` export encodes structured records as a JSON packed value, but `.env` import does not decode that packed structure; use JSON to preserve structured access (`server.ts:388-405`, `server.ts:442-485`).
- Import has no transaction spanning the full file; each accepted row saves independently (`server.ts:408-435`, `server.ts:476-481`).
- The page's format detector only treats content starting with `[` as JSON (`app.tsx:534-539`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog API and Commands](../api.md)
- [Credential Catalog Management](catalog-management.md)
