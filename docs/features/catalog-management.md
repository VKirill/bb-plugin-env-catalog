---
title: Credential Catalog Management
type: component
created: 2026-09-27
updated: 2026-09-28
status: active
confidence: medium
tags: [credentials, catalog, user-interface]
sources:
  - app.tsx
  - server.ts
  - kinds.ts
  - contracts.ts
  - i18n.ts
---

# Credential Catalog Management

TL;DR: The Env Catalog page lets an operator find, add, inspect, copy, edit, and delete named credentials; the server validates and encrypts values before storing them in the BB plugin database (`app.tsx:408-547`, `server.ts:311-363`).

## Purpose

The page is registered in the BB navigation as `env-catalog` and uses typed RPC calls to operate on the server-side catalog (`app.tsx:1030-1037`, `app.tsx:366-394`).

The page text defaults to English and uses Russian when the BB document language starts with `ru` (`i18n.ts:1-4`, `i18n.ts:83-86`, `i18n.ts:167-182`).

## How it works

1. `EnvCatalogPage` gets the RPC client, rows, search state, loading state, error reporter, and refetch function from `useEnvCatalog`. That hook fetches `env_list` on mount and after `env-catalog:changed`; a successful fetch replaces the rows and clears the error, while a failed fetch reports the error and the loading flag is cleared (`app.tsx:366-394`).
2. Search text is sent to `env_list`, which matches name, service, description, and kind and orders matches by name. The page's separate kind selector branches between all rows and one of the four credential kinds (`app.tsx:377-390`, `app.tsx:408-410`, `app.tsx:550-554`, `server.ts:244-285`).
3. Add opens a blank secret form. Edit first requests `env_get_value`; on success it fills the form and opens the dialog, while an RPC error is reported and the dialog is not opened (`app.tsx:438-453`, `server.ts:566-580`).
4. Save returns immediately when the trimmed name is empty. Otherwise it sets the pending state and calls `env_save` with the selected kind, secret `value` or structured `access`, plus service and description; success closes the dialog and refetches, failure is reported, and the pending state is cleared in `finally` (`app.tsx:455-477`). The server validates and packs kind-specific access, encrypts it, writes or replaces the row, and publishes a change event (`kinds.ts:57-103`, `server.ts:311-353`).
5. Reveal fetches `env_get_value` and displays its `reveal` text; toggling an already revealed row hides it. Fetch errors are reported and the per-row reveal flag is cleared (`app.tsx:489-506`, `server.ts:566-580`). Summaries mask secret values and show only connection identifiers for structured credentials (`server.ts:272-308`, `kinds.ts:150-175`).
6. Delete starts from a confirmation dialog, then calls `env_delete`; any resolved call closes the confirmation and refetches the list, while a thrown error is reported (`app.tsx:479-487`, `app.tsx:814-830`, `server.ts:355-363`).
7. Export calls `env_export` and opens the returned content; import chooses JSON when trimmed input starts with `[` and otherwise chooses `.env`, then calls `env_import` with overwrite enabled. Machine-environment import calls `env_import_machine_env`. Each action reports RPC errors; successful imports refetch the list (`app.tsx:426-436`, `app.tsx:519-547`).

### `EnvCatalogPage` branches and outcomes

| Branch | Condition | Outcome | Failure or empty case |
|---|---|---|---|
| Kind filter | `all` or a selected kind. | Shows all fetched rows or only rows of that kind (`app.tsx:550-554`). | An empty result remains an empty filtered list. |
| Add | Operator chooses Add. | Clears the edit name, resets a blank form, and opens the dialog (`app.tsx:438-442`). | No RPC call occurs until save. |
| Edit | Operator selects a row. | Fetches its full record and populates the form (`app.tsx:444-449`). | Lookup failure is reported; the dialog stays closed (`app.tsx:450-452`). |
| Save with blank name | `formData.name.trim()` is empty. | Returns without sending `env_save` (`app.tsx:455-458`). | No inline error is set by this handler. |
| Save with a name | Trimmed name is non-empty. | Saves; success closes and refreshes the list (`app.tsx:459-471`). | RPC/validation failure is reported; dialog stays open; pending resets (`app.tsx:472-476`). |
| Reveal | Row is hidden or already revealed. | Fetches and displays reveal text, or removes it from reveal state (`app.tsx:489-501`). | Fetch errors are reported and reveal-pending state resets (`app.tsx:502-505`). |
| Delete | Operator confirms a named row. | Any resolved RPC call closes confirmation and refetches; the UI does not inspect the returned `success` boolean (`app.tsx:479-483`). | Thrown RPC error is reported (`app.tsx:484-485`). |
| Copy | Operator clicks copy. | Writes the supplied text to clipboard and marks the item copied; that marker clears after two seconds (`app.tsx:509-513`). | Clipboard failure is reported (`app.tsx:514-516`). |
| Export | Operator selects `env` or `json`. | Calls `env_export`, stores returned content, and opens the export dialog (`app.tsx:519-523`). | RPC error is reported (`app.tsx:524-526`). |
| Import | Trimmed input is non-empty; a leading `[` selects JSON, otherwise `.env`. | Calls `env_import` with overwrite enabled, closes the dialog, clears input, and refetches (`app.tsx:529-543`). | Blank input returns without a call; RPC error is reported and pending state resets (`app.tsx:529-547`). |
| Machine-environment import | Operator triggers synchronization. | Calls `env_import_machine_env` and refetches (`app.tsx:426-430`). | RPC error is reported and the pending flag resets (`app.tsx:431-435`). |

### `rpcContract` and handler dispatch

1. `rpcContract` declares each operation's input and output schema. The UI derives its typed RPC client from that contract; the server registers a handler map against the same contract (`server.ts:56-128`, `app.tsx:366-368`, `server.ts:562-599`).
2. The BB RPC layer dispatches each operation to its matching handler. Read operations return summaries or a decrypted full record; writes call the common save/delete/import/export functions and return operation-specific results (`server.ts:562-599`).
3. Handler errors propagate to the RPC caller. A missing `env_get_value` record throws; validation, decryption, or import errors from called functions also reject the operation (`server.ts:566-570`, `server.ts:582-598`, `server.ts:311-350`, `server.ts:408-491`).

| RPC operation | Input conditions or modes | Outcome | Failure behavior |
|---|---|---|---|
| `env_list` | Optional nullable text query and kind filter. | `variables` contains matching summaries (`server.ts:57-65`, `server.ts:563-565`). | Query/database errors reject the call. |
| `env_get_value` | Required name. | Returns kind, value/access, reveal text, and metadata (`server.ts:66-80`, `server.ts:566-580`). | Missing name throws a not-found error (`server.ts:566-570`). |
| `env_save` | Trimmed non-empty name; kind, value/access, description, service, and tags are optional or nullable. | Saves/replaces a record and returns success plus normalized name (`server.ts:81-95`, `server.ts:582-585`). | Empty secret values or invalid/oversized structured access fail in the save path (`server.ts:311-350`, `kinds.ts:57-103`). |
| `env_delete` | Required name. | Returns `success: true` when a row is deleted and `false` when no row matched (`server.ts:96-103`, `server.ts:355-363`, `server.ts:586-589`). | No matching row is represented by `false`; it does not throw. |
| `env_export` | Format is `env` or `json`. | Returns serialized content (`server.ts:104-111`, `server.ts:590-592`). | Export/decryption errors reject the call (`server.ts:366-405`). |
| `env_import` | Content and format `env` or `json`; overwrite defaults to `true`. | Imports accepted entries and returns their count (`server.ts:112-120`, `server.ts:593-595`). | Invalid JSON throws; malformed or unsupported rows may be skipped, while save validation errors reject (`server.ts:408-491`). |
| `env_import_machine_env` | Input is `null`. | Returns the number of imported records (`server.ts:122-127`, `server.ts:596-598`). | Missing source files or invalid key format returns zero; individual decryption failures are logged and skipped (`server.ts:493-559`). |

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
| RPC `env_delete` | `server.ts:96-103`, `server.ts:586-589` | Delete a record through the BB plugin RPC interface. |

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
- [Secure Credential Requests](secure-requests.md)
- [Env Catalog Overview](../overview.md)
