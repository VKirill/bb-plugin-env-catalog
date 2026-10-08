---
name: env-catalog
description: "Unified encrypted catalog of API keys, FTP/SFTP, SSH keys, and site logins. Use when you need credentials for an external service, server, or website, or to save a newly provided secret across sessions and machines."
---

# Env Catalog

> **Reading is free.** `env_get` (and `bb env-catalog get NAME --raw` in a shell) returns the value at once from any session: no grant, no form, no wait. Every read, save and delete is written to the issuance journal (thread, project, name, time, your optional `purpose`; never the value), shown on the Env Catalog page as «Журнал выдачи». Keep the value out of the chat reply and out of files (`~/.config/...`, `.env` in a repo): load it into a shell variable or pipe it straight to the consumer, and ask again next time instead of caching it.

Encrypted storage on the BB server for API keys, FTP/FTPS/SFTP accounts, SSH private keys, and site logins. Every enrolled machine sees the same catalog.

## When to Use

1. **Before asking the user for any access** (API key, FTP, SSH, panel login):
   - `env_list` — names, kinds, hosts (values omitted).
   - `env_get` with the exact name: the value comes back at once.
2. **If it is missing:** call `env_request` with `name` and `kind` (`secret` | `ftp` | `ssh` | `login`). Never ask the user to paste secrets into chat.
3. **If they already pasted a credential in the thread** and asked you to keep it: save it with `env_set` (and do not repeat it in your reply). If they did not ask to keep it, use it for the task and tell them it is not saved.
4. **File Gateway FTP** is only for browsing site files inside BB. Use Env Catalog when a script, `ssh`, deploy, or API call needs the credential.

Do not repeat decrypted secrets in the chat reply. Use them in tools and commands.

## Kinds

| kind | What `env_get` returns |
| --- | --- |
| `secret` | `value` — API key, token, or raw PEM stored as one string |
| `ftp` | `access`: protocol (`ftp`/`ftps`/`sftp`), host, port, username, password, optional root and fingerprint |
| `ssh` | `access`: host, port, username, privateKey, optional passphrase and fingerprint |
| `login` | `access`: url and/or host, username, password |

Names stay env-style: `OPENAI_API_KEY`, `OVH_SSH`, `FTP_OHMYSEO`.

## Agent Tools

### `env_list`
```json
{ "query": "ovh", "kind": "ssh" }
```
`kind` is optional. Result includes `name`, `kind`, `service`, `description`, `summary` (masked).

### `env_get`
```json
{ "name": "OVH_SSH", "purpose": "deploy the site to OVH" }
```
`purpose` is optional (one short sentence; it goes to the journal). Result: `found:true` with `kind`, `value` / `access`, `description`, `service`; or `found:false` with a hint to call `env_list`.

### `env_set`
Saves or updates an entry; use it when the owner pastes a credential into the chat and wants it kept. API key:
```json
{ "name": "TAVILY_API_KEY", "value": "tvly-xxxx", "service": "Tavily" }
```
SSH:
```json
{
  "name": "OVH_SSH",
  "kind": "ssh",
  "host": "1.2.3.4",
  "port": 22,
  "username": "ubuntu",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
  "service": "OVH"
}
```
FTP:
```json
{
  "name": "FTP_SITE",
  "kind": "ftp",
  "protocol": "ftps",
  "host": "ftp.example.com",
  "port": 21,
  "username": "deploy",
  "password": "…",
  "root": "/public_html"
}
```

### `env_request`
```json
{ "name": "OVH_SSH", "kind": "ssh", "purpose": "Need SSH to deploy on OVH", "service": "OVH" }
```

### `env_delete`
Deletes an entry (recorded in the journal). Delete only what the owner asked you to delete.
```json
{ "name": "OLD_TOKEN" }
```

## CLI

Every command works from any session, an agent shell included; reads, saves and deletes are journalled. `get` accepts `--purpose "text"` for the journal.

```bash
bb env-catalog list [--kind ssh]
bb env-catalog get OVH_SSH --raw --purpose "deploy"   # prints the secret at once; do not paste the output into the chat
bb env-catalog set OPENAI_API_KEY sk-proj-... --service OpenAI
bb env-catalog set OVH_SSH --kind ssh --host 1.2.3.4 --user ubuntu --private-key "-----BEGIN…"
bb env-catalog request OVH_SSH --kind ssh --purpose "Deploy"
bb env-catalog export --format json      # prints every secret: only when the owner asked for an export
```
