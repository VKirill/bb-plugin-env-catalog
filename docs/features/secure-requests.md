---
title: Secure Credential Requests
type: component
created: 2026-09-27
updated: 2026-09-28
status: active
confidence: medium
tags: [credentials, requests, pending-interaction]
sources:
  - server.ts
  - app.tsx
  - contracts.ts
  - kinds.ts
  - i18n.ts
---

# Secure Credential Requests

TL;DR: The `env_request` agent tool or CLI `request` command asks BB to render a typed pending interaction; the plugin UI validates submitted fields and the server stores completed entries through the shared encrypted save path (`server.ts:786-859`, `server.ts:861-959`, `app.tsx:894-1008`).

## Purpose

The request flow collects credentials through a BB in-thread form associated with `env-catalog-request`, instead of receiving the values as ordinary tool arguments (`contracts.ts:70`, `server.ts:786-830`).

The renderer uses the shared translated labels; locale selection is described in [Catalog management](catalog-management.md) (`app.tsx:917-924`, `app.tsx:995-1023`, `i18n.ts:170-182`).

## How it works

1. The agent tool or CLI command builds request metadata: name, kind, purpose, description, and service (`server.ts:911-940`, `server.ts:1192-1219`).
2. `requestSecretsFromUser` calls `bb.ui.requestInput` with renderer ID, payload, thread, abort signal, and response schema (`server.ts:786-830`).
3. BB renders `EnvCatalogRequestInteraction`; the UI checks the payload, initializes one form per field, and shows a dismiss action for invalid input (`app.tsx:894-928`).
4. On submit, secret values must be non-empty and within the byte limit; structured access is assembled from the selected kind's fields and checked with `envRequestResponseSchema` (`app.tsx:930-977`, `contracts.ts:29-66`).
5. The UI calls BB `submit`; the server validates the response and saves entries through `saveVariable` (`app.tsx:978-1008`, `server.ts:831-859`).
6. The caller receives saved names. Cancellation returns a cancelled result and bypasses persistence (`server.ts:942-959`, `server.ts:1222-1231`).

### Request modes

| Kind | Form fields | Validation and failure |
|---|---|---|
| `secret` | One secret text value. | Required, non-empty, maximum 65,536 bytes; larger values show an inline error (`app.tsx:940-950`, `contracts.ts:29-35`). |
| `ftp` | Protocol, host, port, username, password, optional root and fingerprint. | Server-side structured validation applies after the form response (`kinds.ts:13-21`, `kinds.ts:81-88`). |
| `ssh` | Host, port, username, private key, optional passphrase and fingerprint. | Server-side structured validation applies after the form response (`kinds.ts:23-30`, `kinds.ts:89-95`). |
| `login` | URL or host, username, password. | At least one of URL or host is required (`kinds.ts:32-37`, `kinds.ts:96-103`). |

### Failures

- Missing thread context returns an error before the prompt is opened (`server.ts:902-909`).
- Empty requested names fail before opening the prompt (`server.ts:911-927`).
- Invalid request payload renders an error and offers dismissal; invalid values render a form error without submitting (`app.tsx:917-926`, `app.tsx:930-977`).
- User dismissal/cancellation returns a cancelled outcome; the persistence function is reached only for completed payloads (`server.ts:942-951`).
- A failed submit resets the busy state and retains an error message in the form (`app.tsx:978-1008`).

## Business rules

- At least one field must be requested; each field name must be a trimmed environment-variable identifier beginning with a letter or underscore and containing only letters, digits, or underscores (`contracts.ts:4-18`, `contracts.ts:22-25`).
- Agent requests accept one `name`, a comma-separated name string, or a non-empty `names` array; blank items are ignored (`server.ts:911-927`).
- CLI requests need an active thread from the command context, `BB_THREAD_ID`, or `--thread`; the command reports an error if none is available (`server.ts:1192-1205`).
- Submitted entries default to kind `secret`; field description and service are fallback metadata when omitted from a submitted entry (`server.ts:831-859`).

## Public API

| Entry point | Definition | Purpose |
|---|---|---|
| Agent tool `env_request` | `server.ts:861-959` | Request one or more credentials from the active thread. |
| CLI `bb env-catalog request` | `server.ts:1067-1071`, `server.ts:1192-1231` | Request credentials from a selected/current thread. |
| Renderer `env-catalog-request` | `contracts.ts:70`, `app.tsx:1039-1041` | Render the BB pending interaction form. |

See [API](../api.md) for schemas and [Agent access](agent-access.md) for the tool set.

## Gotchas

- The strict name regex applies to secure requests, while ordinary `env_save` and CLI `set` do not use `secretNameSchema` (`contracts.ts:4-12`, `server.ts:81-89`, `server.ts:1153-1189`).
- The form response schema accepts either a `values` map or an `entries` array; server persistence prefers a non-empty entries array (`contracts.ts:52-66`, `server.ts:831-859`).
- Cancellation is a normal outcome shape, not a saved empty value (`server.ts:942-951`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog API and Commands](../api.md)
- [Env Catalog Architecture](../architecture.md)
- [Agent Access to Credentials](agent-access.md)
- [Credential Catalog Management](catalog-management.md)
- [Env Catalog Overview](../overview.md)
