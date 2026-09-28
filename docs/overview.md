---
title: Env Catalog Overview
type: overview
created: 2026-09-27
updated: 2026-09-28
status: active
confidence: medium
tags: [bb-plugin, credentials, overview]
sources:
  - package.json
  - server.ts
  - app.tsx
  - kinds.ts
  - contracts.ts
  - i18n.ts
  - tsconfig.json
---

# Env Catalog Overview

TL;DR: Env Catalog is a BB plugin that stores named credentials in the BB server's SQLite storage, encrypts their values with AES-256-GCM, and exposes them through a navigation page, agent tools, RPC, and CLI commands (`server.ts:152-211`, `server.ts:562-599`, `server.ts:601-959`, `server.ts:1046-1087`).

## What it is

The catalog stores four credential kinds: plain secret values, FTP/FTPS/SFTP access, SSH access, and site logins (`kinds.ts:3-6`, `kinds.ts:13-37`). Structured access is packed into the encrypted value, while name, service, description, tags, and timestamps occupy separate columns (`kinds.ts:57-78`, `server.ts:202-210`).

BB provides three main access surfaces. The UI offers search, view, edit, delete, import, export, and machine-environment import (`app.tsx:408-547`). Its text is English by default and switches to Russian when `document.documentElement.lang` starts with `ru` (`i18n.ts:1-4`, `i18n.ts:83-86`, `i18n.ts:167-182`). Registered agent tools list, retrieve, save, delete, and request credentials (`server.ts:601-959`). The `bb env-catalog` command group exposes corresponding terminal operations (`server.ts:966-1087`).

## Stack

- TypeScript with strict checking and ES2022 target (`tsconfig.json:1-22`).
- BB Plugin SDK `0.4.87` for plugin APIs, app slots, and RPC (`package.json:26-29`, `server.ts:4`, `app.tsx:4-14`).
- SQLite through BB storage migrations; `better-sqlite3` is a development dependency used by the machine-environment importer (`server.ts:200-212`, `package.json:30-40`).
- Zod `^4.3.6` for RPC and credential validation (`package.json:25`, `server.ts:6`, `kinds.ts:1`).
- React app with HugeIcons and Radix UI dependencies (`package.json:20-25`, `package.json:30-38`).

## Quick start

```bash
npm ci
npm run check
```

The package scripts define dependency validation and build commands; the BB plugin manager handles installation (`package.json:69-73`). See [Deployment](deployment.md) for the repository and host boundary.

## Where to look next

- [Architecture](architecture.md) — server, UI, storage, and their connections.
- [Catalog management](features/catalog-management.md) — credential kinds and CRUD behavior.
- [Secure requests](features/secure-requests.md) — request form and persistence path.
- [API](api.md) — RPC operations, agent tools, and CLI.
- [Data model](data-model.md) — stored fields and key ownership.
