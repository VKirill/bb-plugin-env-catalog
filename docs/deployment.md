---
title: Env Catalog Deployment
type: deployment
created: 2026-09-27
updated: 2026-09-27
status: active
confidence: medium
tags: [deployment, build, bb-plugin]
sources:
  - package.json
  - tsconfig.json
  - server.ts
  - .gitignore
  - app.tsx
---

# Env Catalog Deployment

TL;DR: Install locked npm dependencies, run the repository check or build script, then install the built package through the BB plugin manager. The repository defines no dedicated installation, test, or configuration script (`package.json:69-73`).

## Prerequisites

- Node.js and npm for the TypeScript package; `package-lock.json` records the dependency lock.
- A BB host that meets the manifest's minimum BB and plugin SDK versions (`package.json:4-7`).
- The BB plugin CLI, because the build script invokes `bb plugin build` (`package.json:69-73`).

## Dependency installation and verification

Run from the repository root:

```bash
npm ci
npm run typecheck
npm run build
```

`typecheck` runs `tsc --noEmit`; `build` runs `bb plugin build`; `check` runs the typecheck followed by the build (`package.json:69-73`). TypeScript includes the server, app, contracts, kind helpers, translations, components, hooks, and libraries (`tsconfig.json:1-22`).

The package has no `test` script and the code map reports no tests; `npm run check` is the repository-defined compile/build check (`package.json:69-73`).

## Install and configure on BB

Install the built plugin through the BB plugin manager. The repository manifest declares `server.ts`, `app.tsx`, `skills/`, plugin name, icon, and host version requirements; it does not define a standalone plugin-install command (`package.json:4-18`).

No environment variable is required to configure encryption. At plugin startup the server uses BB `experimental_dataDir`, falling back to `~/.bb`, then creates `plugins/env-catalog/master.key` and the SQLite schema (`server.ts:155-173`, `server.ts:199-221`). The host-owned BB storage API supplies the plugin database (`server.ts:199-212`).

## Verify

- Confirm the BB plugin manager accepts the package; this repository does not define a runtime health-check command.
- Open the Env Catalog navigation entry and load the list; the app fetches `env_list` when mounted (`app.tsx:366-394`, `app.tsx:1030-1037`).
- Verify the BB host can create/load plugin storage and `master.key` at startup (`server.ts:155-212`).

## Rollback

Disable or remove the plugin through the BB plugin manager. The repository defines no uninstall script, database rollback, or cleanup job, so the host-side removal procedure and retained plugin data are managed outside this package (`package.json:69-73`, `server.ts:199-221`, `server.ts:1265-1268`).

## Troubleshooting

- **`bb plugin build` is unavailable:** install or invoke the BB plugin CLI in the build environment; the npm script delegates directly to it (`package.json:71`).
- **Typecheck errors:** run `npm run typecheck` and review the configured `tsconfig.json` include set (`package.json:70`, `tsconfig.json:16-22`).
- **Stored credentials fail to decrypt after startup:** inspect the plugin `master.key`; replacing a key with the wrong length generates a new key, which cannot decrypt old rows ([Gotchas](gotchas.md), `server.ts:162-172`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Env Catalog Overview](overview.md)
