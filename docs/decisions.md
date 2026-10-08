---
title: Env Catalog Decisions
type: decisions
created: 2026-09-27
updated: 2026-10-08
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

## 003. Secret-touching RPC and CLI methods accept only the owner (0.3.1; reverted by 007)

**Context:** BB's HTTP API has no login, so an agent could call `env_get_value`, `env_delete`, `env_export` and the others with `curl`; the shell guard cannot see that (audit 2026-10-08 round 3, P0 item 1).

**Decision:** The plugin declares `vk.rpcCallerPolicy` in `package.json`. A VK core then hands `experimental_vkCaller` to the RPC handlers and the CLI context. `env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `env_import_machine_env` and the CLI `get`, `set`, `delete`, `export`, `import-machine-env` run for `owner-ui` and `owner-cli` only; another plugin may call `env_get_value` (Lane Pilot checks, Image Studio keys). `agent-thread` and `unknown` are refused. `env_list`, `request` and the agent tools are unchanged (the tools keep their own role checks). Logic and tests: `lib/rpc-caller.ts`, `lib/rpc-caller.test.ts`.

**Status:** Active.

**Consequences:** On a core without the function the mark is absent and the plugin keeps the old behaviour (it cannot tell the caller). `owner-*` are client-asserted, so a client that forges them on purpose is not stopped; the shell guard and the agent tools' roles stay in place.

**Sources:** `server.ts` (`guardRpc`, `cliGuard`), `lib/rpc-caller.ts`.

## 004. Changing agent tools refuse; `unverified-owner` is a known caller kind (0.3.2; reverted by 007)

**Context:** Audit 2026-10-08 round 4, P0-6: the tools `env_set` and `env_delete` did not check the caller, so any agent could overwrite or delete a secret. Core is also about to stop trusting the client marks `owner-ui`/`owner-cli` and to report `unverified-owner` for an owner claim it could not verify.

**Decision:** `env_set` and `env_delete` refuse every call (a tool call is an agent call) and point to `env_request` or the Env Catalog page; the refusal runs through `callerRefusal` (`tool_env_set`, `tool_env_delete`). `unverified-owner` is a known kind: every secret RPC and CLI method (`env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `env_import_machine_env`, `cli_*`) refuses it with a message to open the page after the owner signed in. `plugin` keeps `env_get_value`. `env_get`, `env_list`, `env_request` are unchanged.

**Status:** Active.

**Consequences:** An agent can no longer save a credential the owner pasted in chat; it asks through `env_request`. Logic and tests: `lib/rpc-caller.ts`, `lib/rpc-caller.test.ts`.

**Amended:** 0.3.1 closed every read for agents (`env_get_value`, `bb env-catalog get`) and 90412de refused `unverified-owner` on all secret methods. Together that locked out legitimate work (live case 2026-10-08: thread `thr_dd8uu64wwz` could not take the vast.ai key and put it in `~/.config/vastai/key`, which is worse: no audit, readable by any process of the owner). Decisions 005 and 006 replace the blanket refusal for reads with grants and keep the page working before owner login.

## 005. Agents read a value through an owner grant, not a ban (0.3.2; reverted by 007)

**Context:** After 0.3.1 an agent could not get any value. Owner rule 2026-10-08: close access only with a working path for every legitimate consumer (inventory: `docs/consumers.md`). Refusals must say what to do.

**Decision:** An agent asks with the `env_get` tool or `bb env-catalog get NAME --raw` (an agent session; the CLI call is marked `agent-thread` by core). The plugin looks for a grant «name -> this thread» or «name -> this project». With one the value comes back at once. Without one the owner gets a BB form in the agent's thread (`rendererId env-catalog-grant`, title «Выдать NAME треду…?»; the push-notifications plugin turns the interaction title into a push): **Один раз / Всегда для этого проекта / Всегда для этого треда / Нет**. The call **waits** for the answer, at most 10 minutes (`timeoutMs`, the same bound as `env_request`), then returns an instruction instead of a value («no answer, grant NOT given, call env_get again; a new form is posted each time»). Waiting was chosen over «call again» because a BB tool call may block (`env_request` already does) and the agent gets the value in one step without polling. Caveat: a shell tool has its own time limit, so the first request should be the `env_get` tool; the grant then makes later shell calls instant. Two parallel calls for the same name and thread share one form.

Every issuance (tool, CLI, and a plugin's `env_get_value`) is a row in `env_issuance_journal`: time, name, outcome (`issued` / `denied` / `timeout` / `cancelled`), how (`tool` / `cli` / `plugin`), grant kind (`once` / `thread` / `project` / `plugin`), thread id and title, project id and name, the agent's stated purpose, caller kind. Never the value. Standing grants live in `env_grants` and are listed and revoked on the Env Catalog page («Доступ агентов») and by the owner-only RPCs `grant_list`, `grant_create`, `grant_revoke`, `journal_list`. Deleting a secret drops its grants.

**«This skill» is not offered.** The tool call context (`PluginAgentToolContext`) carries `threadId`, `projectId` and an abort signal; the thread metadata and `configure` context carry thread, project, environment, provider and origin. Nothing says which skill the agent is using, and an agent-declared skill name would be self-asserted, so a grant on it would be no grant. Scopes are therefore thread and project. The optional `purpose` argument is shown to the owner and journalled as the agent's own words.

**Write, delete, export, import stay owner-only** (decision 003, unchanged). `env_set` / `env_delete` tools refuse (004). `bb env-catalog get` from an owner terminal and the page's `env_get_value` are not grant-gated.

**Status:** Active.

**Consequences:** A new agent thread costs the owner one tap for a secret, a project grant removes it for that project. A background helper thread the owner does not watch shows the form in that thread; grant the project (page, «Выдать заранее») before the run to avoid the wait. Tests: `lib/server-grants.test.ts` (whole flow over `server.ts`), `lib/grants.test.ts`.

**Sources:** `server.ts` (`readForAgent`, `askOwner`, RPC `grant_*`), `lib/grants.ts`, `contracts.ts`, `app.tsx` (`EnvCatalogGrantInteraction`, `GrantsSection`).

## 006. The form answer counts only through an owner-checked RPC; `unverified-owner` keeps the owner's page working (0.3.2; reverted by 007)

**Context:** The core owner-login work (branch `vk/owner-auth`, `BB_VK_OWNER_AUTH=1`) adds the caller kind `unverified-owner` for a client claim made while login is off (`evidence: "browser-headers"` for the page, `"cli-header"` for the `bb` CLI). Refusing it everywhere (90412de) would lock the owner out of the Env Catalog page until login is on.

**Decision:**
1. **The page and the terminal keep working before login.** `unverified-owner` with `browser-headers` runs the page's RPCs (`env_get_value`, `env_save`, `env_delete`, `env_export`, `env_import`, `env_import_machine_env`, `grant_*`, `journal_list`); with `cli-header` it runs the owner CLI methods (`cli_get`, `cli_set`, `cli_delete`, `cli_export`, `cli_import_machine_env`). The two claims do not cross, and any other evidence is refused. An agent session is never `unverified-owner`: core marks it `agent-thread` from the thread token (a session without a token says `cli-in-thread`, also `agent-thread`). This is a fuse, not a boundary: a script that forges the browser headers is indistinguishable before login (core says so in `VK_FUNCTIONS.md` section 14).
2. **After login is on, no flag is needed here.** With `BB_VK_OWNER_AUTH` enforced core stops emitting `unverified-owner` (headers alone become `unknown`) and emits a verified `owner-ui` (session cookie) or `owner-cli` (request signature). Those pass; `unknown` is refused with an instruction. The plugin reads the kind and nothing else.
3. **The grant answer does not rely on `interactions/respond`.** The form's buttons first call the owner-only RPC `grant_decide` (guarded as in 1 and 2), which writes the decision into the request row; only then does the form submit its interaction value. The waiting tool trusts the row, never the submitted value, so a forged interaction response creates no grant (tested). Once core adds its caller check to `interactions/respond` (403 `vk_owner_required` for a non-owner when login is on), both doors need the verified owner. Env Catalog relies on core for: (a) caller kinds on the RPC and CLI context (`vk.rpcCallerPolicy`), (b) `agent-thread` marking from the thread token, (c) the owner check on `interactions/respond` as defence in depth, not as the only check.
4. **Stock core (no mark):** the caller is `undefined`; the plugin keeps the old open behaviour, the grant flow still runs for tool calls (a tool call is always an agent) but an agent could answer its own form through the RPC. Deploy on a VK core.

**Status:** Active.

**Consequences:** Before login the whole owner path works as in 0.3.0. After login a headless script that calls `bb env-catalog get` outside an agent session (a plugin server shelling out, launchd) becomes `unknown` and is refused with an instruction; such code should call the plugin RPC `env_get_value` (kind `plugin`, journalled). See `docs/consumers.md`.

**Sources:** `lib/rpc-caller.ts`, `lib/rpc-caller.test.ts`, `server.ts` (`guardRpc`, `cliGuard`), core `apps/server/src/services/plugins/vk-rpc-caller.ts` (branch `vk/owner-auth`).

## 007. Agents read, save and delete freely; the journal is the only trace (0.3.3)

**Context:** Owner decision 2026-10-08, overriding the security audit for Env Catalog: «не городить огороды — пусть работает и будет доступно любым агентам получить оттуда API ключи без танцев с бубнами». The 0.3.1–0.3.2 restrictions (003–006) added a grant flow, owner forms with a 10-minute wait, refused `env_set`/`env_delete` for agents, and depended on the VK core function `vk.rpcCallerPolicy`. A stock BB has no such function, so on stock BB those restrictions would not have held while the docs and tool texts claimed they did. The plugin must behave the same on stock BB and on the owner's fork, so nobody installing it on a clean BB is misled.

**Decision:**
1. `env_get` and `bb env-catalog get [--raw]` return the value at once from any session. No grant, no request form, no wait.
2. `env_set` and `env_delete` work for agents again, as before 0.3.1 (the owner often pastes a key into the chat and wants it kept). CLI `set`, `delete`, `export`, `import-machine-env` and every RPC accept any caller.
3. The issuance journal stays as a passive record: who (thread, project), what name, when, the agent's optional `purpose`, never the value. `env_get`, `env_set`, `env_delete` and the matching CLI commands write a row (outcomes `issued`, `saved`, `deleted`). The Env Catalog page shows it as «Журнал выдачи». It is written in the background and never blocks or refuses.
4. Removed: the grant store and its RPCs (`grant_list`, `grant_decide`, `grant_create`, `grant_revoke`), the `env-catalog-grant` form and its renderer, the «Доступ агентов» page block, `lib/grants.ts`, `lib/rpc-caller.ts`, the `vk.rpcCallerPolicy` opt-in in `package.json` and `vk-requires.json`. The plugin reads no caller mark (`experimental_vkCaller`) and has no VK dependency.
5. Database: the migration statements are hashed by the host and cannot change, so `env_grants` and `env_grant_requests` stay empty and unused, and `env_issuance_journal` keeps its 0.3.2 columns (`grant_kind`, `caller` unused). Rows from 0.3.2 stay readable.

**Status:** Active. Supersedes 003, 004, 005 and 006 (kept above as history).

**Consequences:** Any process that can reach the plugin (an agent, or a script calling the BB HTTP API, which has no login) can read, overwrite or delete every entry. This is the owner's accepted trade-off; the journal covers the agent paths (tool and CLI) but not the page or a plugin's `env_get_value`, because stock BB does not say who is calling an RPC. A shell guard in another component (Lane Pilot `guard_shell.py`, `bb-shim.ts`, the OpenCode deny list) must not block `bb env-catalog get/set/delete/export` or the plugin RPC any more; see `docs/consumers.md`. Tests: `lib/server-access.test.ts` (whole flow over `server.ts`), `lib/journal.test.ts`.

**Sources:** `server.ts` (`recordAccess`, the tools and `run`), `lib/journal.ts`, `app.tsx` (`JournalSection`).
