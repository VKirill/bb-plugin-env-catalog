---
title: Agent Access to Credentials
type: component
created: 2026-09-27
updated: 2026-10-08
status: active
confidence: high
tags: [agents, credentials, bb-tools]
sources:
  - server.ts
  - skills/env-catalog/SKILL.md
  - kinds.ts
  - contracts.ts
---

# Agent Access to Credentials

TL;DR: BB agents receive instructions and five registered tools to list, retrieve, save, delete, or securely request credentials; raw values are returned only by retrieval and save/request paths (`server.ts:601-959`, `server.ts:961-964`).

## Purpose

The plugin adds tools to the BB agent runtime so an agent can find a named credential and use its decrypted value or structured connection fields. Instructions tell the agent to list first, retrieve by exact name, avoid repeating secrets in chat, and request missing access through the form (`server.ts:961-964`).

## How it works

1. During plugin startup, the server registers tools with BB through `bb.agents.registerTool` (`server.ts:601-959`).
2. `env_list` filters summaries by text or kind and returns names, metadata, timestamps, and masked summaries without raw values (`server.ts:636-667`).
3. `env_get` looks up an exact name and returns the decrypted secret or structured access **only with the owner's grant** for the thread or project; with none the owner gets a form and the call waits up to 10 minutes (0.3.2, [agent-grants](agent-grants.md)). Missing entries return `found: false` with guidance to list keys.
4. `env_set` builds structured access from flat fields when needed, then calls the common save function (`server.ts:669-752`).
5. `env_delete` removes the named record and reports whether it existed (`server.ts:754-785`).
6. `env_request` asks BB to show the pending-interaction form and persists the submitted values only after completion (`server.ts:861-959`).

### Tool modes

| Tool | Inputs | Output and behavior |
|---|---|---|
| `env_list` | Optional query and kind. | Matching metadata and masked values; raw credential data is omitted (`server.ts:636-667`). |
| `env_get` | Exact name. | `found` flag and decrypted secret or access object; missing names return a message (`server.ts:602-634`). |
| `env_set` | Name plus secret value or structured fields. | Validates kind data and stores the credential (`server.ts:669-752`). |
| `env_delete` | Exact name. | Deletes if found and returns success state (`server.ts:754-785`). |
| `env_request` | Name(s), optional kind/service/purpose. | Opens secure form; cancellation reports a cancelled outcome, completion saves and returns names (`server.ts:861-959`). |

### Failures

- `env_get` reports a missing name without throwing; agents can call `env_list` to inspect available names (`server.ts:615-623`).
- `env_set` propagates validation errors from structured access parsing and common save logic (`server.ts:721-752`, `kinds.ts:81-103`).
- `env_request` returns a failure if no active thread or no requested names are available; cancellation returns without persisting (`server.ts:902-927`, `server.ts:942-949`).

## Business rules

- The contributed instruction says to check `env_list` before requesting credentials, use `env_get` by exact name, and use `env_request` rather than soliciting secrets in chat (`server.ts:961-964`).
- `env_list` omits credential values; `env_get` is the read tool that returns them (`server.ts:636-667`, `server.ts:602-634`).
- `secret` is the default kind for `env_set` and `env_request` when no kind is supplied (`server.ts:720-724`, `server.ts:928-933`).
- `env_request` requires a BB thread context from the tool context or `BB_THREAD_ID` (`server.ts:902-909`).

## Public API

The complete tool and command reference is in [API](../api.md). Agent instructions are shipped in the plugin skill file (`skills/env-catalog/SKILL.md:1-95`).

## Gotchas

- `env_get` returns raw credential material to the agent runtime. The instruction explicitly says not to repeat it in chat (`server.ts:602-634`, `server.ts:961-964`).
- Tool names are registered by this server module; the plugin does not define a separate HTTP endpoint for them (`server.ts:601-959`).
- `env_request` accepts one name, comma-separated names, or a `names` array; whitespace-only items are discarded (`server.ts:911-927`).

See also [secure requests](secure-requests.md), [catalog management](catalog-management.md), and [API](../api.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog API and Commands](../api.md)
- [Credential Catalog Management](catalog-management.md)
- [Secure Credential Requests](secure-requests.md)
