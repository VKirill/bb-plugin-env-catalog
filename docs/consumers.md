---
title: Env Catalog Consumers
type: component
created: 2026-10-08
updated: 2026-10-08
status: active
confidence: medium
tags: [consumers, grants, inventory]
sources:
  - server.ts
  - lib/rpc-caller.ts
  - ~/.agents/skills (grep env-catalog / env_get)
  - plugins/*/src (grep env-catalog / env_get_value)
---

# Env Catalog Consumers

TL;DR: Owner rule 2026-10-08: do not close an access path without checking who uses it. This is the inventory taken for 0.3.2 (grep over `~/.agents/skills`, `~/.bb/skills` (identical copies), the plugins under `BB-сервис/plugins`, `~/.agents` hooks and bin, LaunchAgents; no BB automation or launchd job mentions Env Catalog). Every row names the path that works now.

How a consumer is recognised: an agent session (shell or tool) is `agent-thread` and goes through the owner grant (decision 005). A plugin server calling the plugin RPC is `plugin` and reads on its own authority (journalled). The owner's page and terminal are `owner-*` (or `unverified-owner` while owner login is off, decision 006).

| Consumer | Names | How it gets them | Path that keeps working |
| --- | --- | --- | --- |
| Agent in any thread: `env_get` tool | any | tool call | Grant flow: grant or owner form, waits up to 10 min, journal. |
| Agent in a shell: `bb env-catalog get NAME --raw` (session token present) | any | CLI | Same grant flow; optional `--purpose "text"`. A shell tool has its own time limit, so ask with the `env_get` tool first and let the grant make the shell call instant. |
| Skill `blender-video` `scripts/cloud/cloud_render.py` (vast.ai render, used by `physics-shorts`) | `VASTAI_API_KEY` | was env or the file `~/.config/vastai/key` (workaround written by thread `thr_dd8uu64wwz`) | Prepared change: `vast_key()` calls `bb env-catalog get` (grant flow). The key is already in the catalog. See "vast.ai case" below. |
| Skill `blender-video` `scripts/cloud/build_image.sh` | `DOCKERHUB_TOKEN` | `bb env-catalog get --raw` piped to `docker login` | Grant flow (shell). |
| Skill `blender-video` `scripts/painted/fal_edit.py`, `scripts/assets/meshy.py` | `FAL_KEY` | `subprocess bb env-catalog get --raw` | Grant flow; the subprocess inherits the thread token. |
| Skill `selfystudio` photo pipeline (`tools/photo-pipeline/lib/env.mjs`, `ss-photo.mjs`) | provider keys by name | `process.env`, then `bb env-catalog get --raw` | Grant flow. |
| Skill `tavily` | `TAVILY_API_KEY` | `$TAVILY_API_KEY` or `env_get` | `env_get` tool, grant flow. |
| Skill `computer-use` `bin/sync-env` (writes `.env` of jev / clicker on the Mini) | TypeSafe / jev keys | `bb env-catalog get --raw` per name, ignores a failure | Run from an agent: grant flow (it waits per name; give the project the grants first). From the owner's terminal: not grant-gated. |
| Skill `lane-pilot-workflows` `references/runtime.md` | names in `requires.secrets` | LP preflight checks that names exist; errands read with `env_get` | Preflight: LP server -> plugin RPC (`plugin`, journalled). Errand: `env_get` tool, grant flow. |
| Lane Pilot server | `TYPESAFE_API_KEY`, `requires.secrets` names | `callRpc env-catalog env_get_value` | `plugin` kind: unchanged and journalled. |
| Lane Pilot helpers: errand, QA (`qa-thread.ts` logins), specialists | accounts the PM names | `env_get` tool | Grant flow in the helper's thread. A helper nobody watches blocks until the form is answered: grant the project beforehand (page «Доступ агентов», «Выдать заранее»). |
| Lane Pilot shell guard (`guard_shell.py`, `~/.agents/hooks/guard_shell.py`, opencode permission list) | - | denies `bb env-catalog ... --raw` for LP agents | Not this plugin's code. LP agents use the `env_get` tool, which is the grant flow. The guard text should point there (open item). |
| Image Studio | provider keys | `callRpc env_get_value` | `plugin` kind: unchanged, journalled. |
| `bb-plugin-agency` `src/server/decisions/key.ts` | OpenRouter key | plugin server runs `bb env-catalog get --raw` | Works now (owner CLI claim before login). After owner login is on this becomes `unknown` and is refused: change it to the plugin RPC `env_get_value` (open item, other repo). |
| `bb-plugin-telegram-projects` `adapters.ts` | adapter tokens | plugin server runs `bb env-catalog get --raw` | Same as agency. |
| `bb-plugin-lane-pilot/scripts/jev-router-eval.ts` | `TYPESAFE_API_KEY` | env, then `bb env-catalog get --raw` | From an agent session: grant flow; from the owner's terminal: direct. |
| Owner on the Env Catalog page | all | RPC, `owner-ui` or `unverified-owner/browser-headers` | Unchanged. |
| Owner in a terminal | all | `bb env-catalog get/set/...` | Unchanged (`owner-cli` or `unverified-owner/cli-header`). |

Not found: BB automations or LaunchAgent plists that read Env Catalog. A future headless job (cron, launchd) after owner login is on would be `unknown`: give it an agent thread (grant flow) or a plugin (`env_get_value`).

## vast.ai case (thread `thr_dd8uu64wwz`, read-only findings 2026-10-08)

- The thread "Видеоанализ" (project "Клиенты" `proj_a35nni238u`, claude-code) runs on host `host_7sea4qaad8` ("MAC Mini"), environment path `/Users/vechkasov/Documents/Клиенты/vechkasov.ru`.
- `~/.config/vastai/key` exists on that machine: 64 bytes, mode 600, written 2026-10-08 13:56. Its first and last four characters match the masked catalog entry; the value was not printed.
- The catalog **already holds** `VASTAI_API_KEY` (kind secret, service vast.ai, "vast.ai API key - аренда GPU для рендера Blender"). The thread saved it earlier (history: `env_set` success, then `bb env-catalog get VASTAI_API_KEY --raw` in a shell). So nothing needs to be entered; the owner only has to grant it.
- Script that read the file: `~/.agents/skills/blender-video/scripts/cloud/cloud_render.py` (line ~121; identical copy in `~/.bb/skills`). Doc lines: `~/.agents/skills/physics-shorts/references/gotchas.md:37` (says the file is the way).
- Prepared, not applied: `tmp/vastai-key-from-env-catalog.patch` (apply with `cd ~/.agents/skills && patch -p1 < ...`, then the same patch in `~/.bb/skills` or the usual skills sync).

Steps after 0.3.2 is deployed:
1. Owner: Env Catalog page, «Доступ агентов», «Выдать заранее»: name `VASTAI_API_KEY`, scope «проект», id `proj_a35nni238u` (or answer the form «Всегда для этого проекта» when the thread first asks).
2. Apply the patch; in the thread run `env_get VASTAI_API_KEY` once (form or instant), then `cloud_render.py`.
3. After a successful render move `~/.config/vastai/key` to the Trash (`~/.agents/bin/agent-trash ~/.config/vastai/key`) and check `~/.config/vastai` is empty; look for other copies of the key in the thread's folders.
