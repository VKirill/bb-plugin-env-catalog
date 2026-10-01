---
title: Env Catalog Gotchas
type: gotchas
created: 2026-09-27
updated: 2026-10-01
status: active
confidence: high
tags: [gotchas, credentials, data-integrity]
sources:
  - server.ts
  - kinds.ts
  - contracts.ts
  - app.tsx
---

# Env Catalog Gotchas

TL;DR: Credential handling has sharp edges around master-key replacement, `.env` round trips, path-specific name validation, and exports containing plaintext (`server.ts:162-172`, `server.ts:388-405`, `server.ts:442-485`).

## Critical

### A malformed-length master key is replaced, not recovered

**Problem:** If `master.key` exists but is not exactly 32 bytes, startup generates a new random key and overwrites the file (`server.ts:162-172`).

**Risk:** Existing AES-GCM ciphertext cannot be decrypted with the replacement key (`server.ts:184-196`).

**Workaround:** Preserve the valid key file with the catalog database; restore the matching key before starting the plugin.

### Export output contains decrypted credentials

**Problem:** Both export formats decrypt all rows before serialization (`server.ts:366-405`).

**Risk:** Redirected files, copied text, or logs can expose plaintext secret values.

**Workaround:** Handle exported content as secret material and restrict its storage and access.

## High

### `.env` export and import do not preserve structured records

**Problem:** `.env` export writes structured access as a packed JSON value; `.env` import saves each assignment as a plain secret and does not unpack that JSON (`server.ts:388-405`, `server.ts:442-485`).

**Risk:** An FTP, SSH, or login record round-tripped through `.env` returns as a `secret` value instead of structured access.

**Workaround:** Use JSON export/import to preserve structured fields (`server.ts:384-386`, `server.ts:414-441`).

### Name validation differs between secure requests and ordinary saves

**Problem:** Secure request schemas enforce environment-variable syntax (`contracts.ts:4-12`), while the RPC save schema only trims and requires a non-empty name (`server.ts:81-89`).

**Risk:** A record accepted through one surface can be rejected by `env_request` or be awkward to reference as an environment variable.

**Workaround:** Use names matching `^[A-Za-z_][A-Za-z0-9_]*$` across all entry points.

## Medium

### Machine-environment import skips failures and reports a count

**Problem:** Missing source files or invalid key encoding returns zero; individual row decryption failures are logged and skipped (`server.ts:493-505`, `server.ts:515-555`).

**Risk:** A partial migration can finish with a lower imported count than the source record count.

**Workaround:** Compare the reported count with expected source entries and inspect BB server logs for decryption warnings.

## Low

### CLI has no file-import command

**Problem:** CLI registration includes `import-machine-env`, but no CLI `import` file command; file import is provided by UI RPC (`server.ts:1046-1087`, `server.ts:112-120`).

**Risk:** A shell workflow copied from a prior README or another release can refer to an unavailable command.

**Workaround:** Use the UI import action or call `env_import` through the BB plugin RPC interface (`app.tsx:833-864`, `server.ts:593-595`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog API and Commands](api.md)
- [Env Catalog Data Model](data-model.md)
- [Env Catalog Deployment](deployment.md)
