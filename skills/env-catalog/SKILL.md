---
name: env-catalog
description: "Unified encrypted catalog of API keys, FTP/SFTP, SSH keys, and site logins. Use when you need credentials for an external service, server, or website, or to save a newly provided secret across sessions and machines."
---

# Env Catalog

> **Inside a Lane Pilot errand or PM chat** (`LANE_PILOT_AGENT_TYPE` set / tools `lane_pilot_*` present) read only: `env_list`, `env_get`, `env_request`. Use a value by piping it straight to the consumer or loading it into a shell variable without echo, and never print it (`bb env-catalog get --raw` and `export` write values into the thread's tool output: use `env_get` inside a command instead). `env_set` and `env_delete` change the catalog shared by every machine, so call them only when the owner asked for that change in this chat or the errand is authorized for changes (`authorized: true`).

Encrypted storage on the BB server for API keys, FTP/FTPS/SFTP accounts, SSH private keys, and site logins. Every enrolled machine sees the same catalog.

## When to Use

1. **Before asking the user for any access** (API key, FTP, SSH, panel login):
   - `env_list` — names, kinds, hosts (values omitted).
   - `env_get` with the exact name.
2. **If it is missing:** call `env_request` with `name` and `kind` (`secret` | `ftp` | `ssh` | `login`). Never ask the user to paste secrets into chat.
3. **If they already pasted a credential in the thread** and asked you to keep it: save it with `env_set` so other machines can reuse it. Without that ask, use it for the task and tell them it is not saved.
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
{ "name": "OVH_SSH" }
```

### `env_set`
API key:
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
Only when the owner asked to remove this entry.
```json
{ "name": "OLD_TOKEN" }
```

## CLI

On a VK core, `get`, `set`, `delete`, `export` and `import-machine-env` run only for the owner's own terminal and the Env Catalog page; inside an agent session the CLI answers "Refused" and agents use the tools above (`env_get`, `env_set`, `env_delete`, `env_request`). `list` and `request` work everywhere.

```bash
bb env-catalog list [--kind ssh]
bb env-catalog get OVH_SSH --raw          # prints the secret: terminal only, never in a Lane Pilot thread
bb env-catalog set OPENAI_API_KEY sk-proj-... --service OpenAI
bb env-catalog set OVH_SSH --kind ssh --host 1.2.3.4 --user ubuntu --private-key "-----BEGIN…"
bb env-catalog request OVH_SSH --kind ssh --purpose "Deploy"
bb env-catalog export --format json      # prints every secret: terminal only, owner-requested
```
