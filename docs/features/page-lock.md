---
title: Page Lock (PIN or Password)
type: component
created: 2026-11-25
updated: 2026-11-25
status: active
confidence: high
tags: [security, ui, rpc]
sources:
  - lib/ui-lock.ts
  - server.ts
  - app.tsx
  - contracts.ts
---

# Page Lock (PIN or Password)

TL;DR: The owner can set an optional PIN or password for the Env Catalog page. When it is set, the page shows a lock screen, and the server refuses each page RPC that does not have a live unlock token. Agents, the CLI and other plugins are not affected (decision 008).

## Use

1. On the Env Catalog page, click **Set PIN** (or **Set password**, see Settings). Type it two times. A PIN has 4 to 12 digits. A password has 6 to 128 characters.
2. The page stays open. Other open pages lock at once.
3. To open a locked page, type the PIN or password and click **Unlock**.
4. To lock the page immediately, click **Lock**.
5. To change or remove the lock, click **PIN** (or **Password**). Both actions need the current PIN or password. The server checks it, so a direct RPC call cannot skip it.

## Settings

Open **Settings > Plugins > Env Catalog**, or use `bb plugin config env-catalog set <key> <value>`.

| Key | Default | Range | Effect |
| --- | --- | --- | --- |
| `lockType` | `pin` | `pin`, `password` | Kind of the next PIN or password set on the page. A stored one keeps its kind until it is changed. A PIN shows a number keypad on phones. |
| `autoLockMinutes` | 5 | 1 to 120 | The page locks after this many minutes without input. The server session ends after the same time without a call. |
| `maxAttempts` | 5 | 3 to 10 | Wrong attempts before the lockout starts. |
| `lockoutMinutes` | 1 | 1 to 60 | First lockout. Each further wrong attempt doubles it, to a maximum of 60 minutes. |

The settings page does not need the PIN, so the ranges have hard limits: a person who can open the settings cannot remove the lock or make guessing fast. The server also clamps stored values to these ranges.

The page locks again:

- after `autoLockMinutes` without input (pointer, key or wheel) on the page,
- when you go to a different page in BB,
- when the PIN is changed or removed in a different page,
- when the server session ends (`autoLockMinutes` without a page RPC or keepalive, or a plugin reload).

## Forgotten PIN

Run this command on a machine that is enrolled in the BB server:

```sh
bb env-catalog lock reset
```

`bb env-catalog lock status` shows if a PIN is set. The CLI can already read and export every entry, so a reset from the CLI does not decrease the protection.

## What the lock protects

The lock gates these page RPCs: `env_list`, `env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `journal_list`. Each call must send `unlockToken`.

The lock does not gate these paths:

- the agent tools (`env_get`, `env_set`, `env_delete`, `env_list`, `env_request`),
- the CLI (`bb env-catalog get`, `export`, and the other commands),
- RPC calls from other plugins (`bb.sdk.plugins.callRpc`, caller kind `plugin`; the host verifies this kind).

Thus a person who can start a BB thread can still ask an agent for a value. The lock stops one-click reveal, copy and export on the page, for example on a shared or unattended screen.

## Server design

- `lib/ui-lock.ts` keeps one row in `env_ui_lock`: the kind (`pin` or `password`), a scrypt hash (N=2^15, r=8, p=1, 64 bytes) and a random 16-byte salt. The passcode is not stored. The comparison uses `timingSafeEqual`.
- `lock_unlock` returns a random 32-byte token. The server keeps tokens in memory with an idle expiry of `autoLockMinutes`. Each gated call and each `lock_status` call with a live token moves the expiry forward.
- After `maxAttempts` wrong attempts, each check is blocked for `lockoutMinutes`. The delay doubles after each further wrong attempt, to a maximum of 60 minutes. A correct passcode sets the count to zero. Checks run one at a time, so parallel guesses cannot pass the limit. The count and the lockout end are in the database (`env_ui_lock_attempts`), so a plugin reload or a disable and enable does not reset them.
- `lock_set` and `lock_disable` end every session and publish `env-catalog:lock-changed`. A settings change publishes it too, so open pages read the new timing. `lock_set` returns a new token for the page that made the change.

## RPC

| Method | Input | Output |
| --- | --- | --- |
| `lock_status` | `unlockToken?` | `enabled`, `unlocked`, `retryAfterMs`, `kind`, `newKind`, `autoLockMs` |
| `lock_unlock` | `passcode` | `unlockToken` |
| `lock_lock` | `unlockToken?` | `success` |
| `lock_set` | `currentPasscode` (null when no PIN is set), `passcode` | `unlockToken` |
| `lock_disable` | `passcode` | `success` |

## Tests

- `lib/ui-lock.test.ts`: hash storage, sessions, idle expiry, keepalive, attempt limit, parallel guesses, PIN digits, settings and their clamping, change, remove, reset.
- `lib/server-access.test.ts`: page RPCs are refused without a token and with a false token; agents, the CLI and plugin callers still read; `bb env-catalog lock status|reset`.
