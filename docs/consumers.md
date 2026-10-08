---
title: Env Catalog Consumers
type: component
created: 2026-10-08
updated: 2026-10-08
status: active
confidence: medium
tags: [consumers, inventory]
sources:
  - server.ts
  - ~/.agents/skills (grep env-catalog / env_get)
  - plugins/*/src (grep env-catalog / env_get_value)
---

# Env Catalog Consumers

TL;DR: Since 0.3.3 every consumer reads the same way, with no grant and no caller check: the `env_get` tool, `bb env-catalog get NAME --raw`, or the plugin RPC `env_get_value`. This inventory (taken 2026-10-08 for 0.3.2, grep over `~/.agents/skills`, `~/.bb/skills`, the plugins under `BB-сервис/plugins`, `~/.agents` hooks and bin, LaunchAgents) is kept so a future restriction starts from the list of who depends on the catalog (owner rule: never close a path without checking who uses it). No BB automation or launchd job mentions Env Catalog.

| Consumer | Names | How it gets them |
| --- | --- | --- |
| Any agent: `env_get` tool | any | tool call, value at once; journalled |
| Any agent shell: `bb env-catalog get NAME --raw [--purpose text]` | any | CLI, value at once; journalled when the session carries a thread id |
| Skill `blender-video` `scripts/cloud/cloud_render.py` (vast.ai render, used by `physics-shorts`) | `VASTAI_API_KEY` | was the file `~/.config/vastai/key` (a workaround from thread `thr_dd8uu64wwz`); `bb env-catalog get` works directly now (patch in `tmp/vastai-key-from-env-catalog.patch`) |
| Skill `blender-video` `scripts/cloud/build_image.sh` | `DOCKERHUB_TOKEN` | `bb env-catalog get --raw` piped to `docker login` |
| Skill `blender-video` `scripts/painted/fal_edit.py`, `scripts/assets/meshy.py` | `FAL_KEY` | `subprocess bb env-catalog get --raw` |
| Skill `selfystudio` photo pipeline (`tools/photo-pipeline/lib/env.mjs`, `ss-photo.mjs`) | provider keys by name | `process.env`, then `bb env-catalog get --raw` |
| Skill `tavily` | `TAVILY_API_KEY` | `$TAVILY_API_KEY` or `env_get` |
| Skill `computer-use` `bin/sync-env` (writes `.env` of jev / clicker on the Mini) | TypeSafe / jev keys | `bb env-catalog get --raw` per name |
| Skill `lane-pilot-workflows` `references/runtime.md` | names in `requires.secrets` | LP preflight checks that names exist; errands read with `env_get` |
| Lane Pilot server | `TYPESAFE_API_KEY`, `requires.secrets` names | `callRpc env-catalog env_get_value` |
| Lane Pilot helpers: errand, QA (`qa-thread.ts` logins), specialists | accounts the PM names | `env_get` tool |
| Lane Pilot shell guard (`guard_shell.py`, `~/.agents/hooks/guard_shell.py`, opencode permission list, `bb-shim.ts`) | - | denied `bb env-catalog ... --raw` for LP agents; the owner decision 2026-10-08 removes those rules (Lane Pilot change, not this plugin) |
| Image Studio | provider keys | `callRpc env_get_value` |
| `bb-plugin-agency` `src/server/decisions/key.ts` | OpenRouter key | plugin server runs `bb env-catalog get --raw` |
| `bb-plugin-telegram-projects` `adapters.ts` | adapter tokens | plugin server runs `bb env-catalog get --raw` |
| `bb-plugin-lane-pilot/scripts/jev-router-eval.ts` | `TYPESAFE_API_KEY` | env, then `bb env-catalog get --raw` |
| Owner on the Env Catalog page / in a terminal | all | RPC and CLI, unchanged |

## vast.ai case (thread `thr_dd8uu64wwz`, findings 2026-10-08)

The thread "Видеоанализ" (project "Клиенты" `proj_a35nni238u`) put the key in `~/.config/vastai/key` because 0.3.1 refused every agent read. The catalog already holds `VASTAI_API_KEY`. With 0.3.3 `env_get VASTAI_API_KEY` returns it at once, so the file can be moved to the Trash (`~/.agents/bin/agent-trash ~/.config/vastai/key`) after the patch above is applied.
