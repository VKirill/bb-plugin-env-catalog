---
title: Credential Catalog Management
type: component
created: 2026-09-27
updated: 2026-09-27
status: active
confidence: medium
tags: [credentials, catalog, user-interface]
sources:
  - app.tsx
  - server.ts
  - kinds.ts
  - contracts.ts
---

# Credential Catalog Management

TL;DR: The Env Catalog page lets an operator find, add, inspect, copy, edit, and delete named credentials; the server validates and encrypts values before storing them in the BB plugin database (`app.tsx:408-547`, `server.ts:311-363`).

## Purpose

The page is registered in the BB navigation as `env-catalog` and uses typed RPC calls to operate on the server-side catalog (`app.tsx:1030-1037`, `app.tsx:366-394`).

## How it works

1. The page fetches summaries with `env_list`; queries filter on name, service, description, or kind, and results are ordered by name (`app.tsx:377-394`, `server.ts:244-285`).
2. Summaries mask plain secret values and show only non-secret connection identifiers for structured credentials (`server.ts:272-308`, `kinds.ts:150-175`).
3. Reveal and edit call `env_get_value`, which returns decrypted display text and structured access. The UI fills its form from that response (`app.tsx:444-453`, `app.tsx:489-506`, `server.ts:566-580`).
4. Save validates and packs kind-specific access, encrypts it, writes or replaces the row, and publishes a catalog-change event (`kinds.ts:57-103`, `server.ts:311-353`).
5. Delete removes the named row; successful saves and deletes publish events that cause the page to reload summaries (`server.ts:355-363`, `app.tsx:388-394`).

### Credential modes

| Kind | Input and validation | Stored content / display |
|---|---|---|
| `secret` | Non-empty text, maximum 65,536 UTF-8 bytes (`kinds.ts:57-69`). | Encrypted text; masked summary and reveal/copy text (`kinds.ts:150-175`, `kinds.ts:177-200`). |
| `ftp` | Protocol `ftp`, `ftps`, or `sftp`; host, port, username, password; optional root and fingerprint (`kinds.ts:13-21`). | Encrypted packed access; summary shows protocol, username, host, and port (`kinds.ts:73-78`, `kinds.ts:155-158`). |
| `ssh` | Host, port, username, private key; optional passphrase and fingerprint (`kinds.ts:23-30`). | Encrypted packed access; summary shows username, host, and port (`kinds.ts:73-78`, `kinds.ts:159-162`). |
| `login` | Username and password; requires a URL or host (`kinds.ts:32-37`, `kinds.ts:96-103`). | Encrypted packed access; summary shows username and URL or host (`kinds.ts:163-168`). |

### Failures

- Empty or oversized secrets and invalid structured access throw validation errors before persistence (`kinds.ts:57-103`).
- A reveal or edit for a missing name returns a not-found error from RPC; the UI catches it and reports it in page state (`server.ts:566-570`, `app.tsx:444-453`, `app.tsx:489-505`).
- Clipboard rejection is caught and reported as a UI error (`app.tsx:509-517`).
- Delete is permanent; there is no restore handler (`server.ts:355-363`, `app.tsx:814-830`).

## Business rules

- Names are trimmed when saved. Ordinary `env_save` only requires a trimmed, non-empty string; strict environment-variable syntax is applied by secure request schemas (`server.ts:81-89`, `server.ts:321-323`, `contracts.ts:4-12`).
- Saving an existing name replaces that row and preserves its original `created_at` value (`server.ts:327-350`).
- Missing service labels are inferred from the name and kind for a fixed set of recognized providers and access categories (`server.ts:132-150`, `server.ts:341-350`).
- FTP/SSH ports must be integers from 1 to 65,535; defaults used by the form/flat CLI helper are 21 for FTP-family protocols except SFTP and 22 for SSH/SFTP (`kinds.ts:10-11`, `kinds.ts:222-266`).

## Public API

See [API](../api.md) for RPC and CLI request details.

| Interface | Definition | Purpose |
|---|---|---|
| `env_list` | `server.ts:56-65` | Search and list masked summaries. |
| `env_get_value` | `server.ts:66-80` | Retrieve a full record for reveal or edit. |
| `env_save` | `server.ts:81-95` | Create or replace a record. |
| `env_delete` | `server.ts:96-103` | Delete a record. |

## Gotchas

- A displayed structured summary omits passwords and private keys; the full values are returned only by `env_get_value` (`kinds.ts:202-220`, `server.ts:566-580`).
- Tags are accepted by server save and RPC but the current page passes `null` on save (`app.tsx:455-469`, `server.ts:311-350`).
- A search query is applied to `kind` in addition to name, service, and description (`server.ts:249-256`).

Related capabilities: [agent access](agent-access.md), [secure requests](secure-requests.md), and [import/export](import-export.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog API and Commands](../api.md)
- [Env Catalog Data Model](../data-model.md)
- [Agent Access to Credentials](agent-access.md)
- [Env Catalog Overview](../overview.md)
