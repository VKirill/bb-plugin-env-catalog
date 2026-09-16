---
name: env-catalog
description: "Unified encrypted catalog of environment variables and API keys. Use when you need external service credentials, tokens, or need to save a newly provided API key across sessions and machines."
---

# Env Catalog

Encrypted, centralized storage for API keys, tokens, and environment variables shared across all BB sessions and connected machines.

## When to Use

1. **Before asking the user for an API key:**
   Check if the key is already stored in the catalog.
   - Run `env_list` to see available keys.
   - Run `env_get` with the exact variable name (e.g. `OPENAI_API_KEY`, `TAVILY_API_KEY`).
2. **If a required API key or secret is missing:**
   **DO NOT ask the user to type or paste secrets into chat** (to avoid leaking into transcripts and LLM context).
   Instead, call `env_request`. This opens a secure masked modal in the BB interface where the user can enter the key safely. The value is encrypted (AES-256-GCM) and stored directly in the Env Catalog.
3. **When the user provides an API key or token in conversation:**
   Automatically save it to the catalog using `env_set` so future turns and other machines can reuse it.
4. **When generating a local `.env` file for a project or script:**
   Retrieve the needed keys using `env_get` and populate the local file.

## Agent Tools

### `env_request`
Securely prompts the user with an in-app masked dialog in the thread to enter an API key or secret. The value is encrypted with AES-256-GCM and saved directly to the Env Catalog. It never appears in chat history or context.
```json
// Example call:
{
  "name": "OPENAI_API_KEY",
  "purpose": "Required to run OpenAI model completions",
  "service": "OpenAI",
  "description": "OpenAI API key"
}

// Or requesting multiple keys at once:
{
  "names": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  "purpose": "Configure AI providers"
}
```

### `env_list`
Lists all available keys in the catalog without disclosing values (preserves token budget and prevents accidental leaks).
```json
// Example call:
{ "query": "openai" }
```

### `env_get`
Retrieves the decrypted secret value by exact variable name.
```json
// Example call:
{ "name": "OPENAI_API_KEY" }
```

### `env_set`
Stores or updates a secret in the catalog.
```json
// Example call:
{
  "name": "TAVILY_API_KEY",
  "value": "tvly-xxxx",
  "service": "Tavily",
  "description": "API key for Tavily web search"
}
```

### `env_delete`
Removes a variable from the catalog.
```json
// Example call:
{ "name": "OLD_TOKEN" }
```

## CLI Usage (Terminal)

The plugin also exposes a CLI tool for scripts and terminal sessions:
```bash
# List stored variables
bb env-catalog list

# Get a secret value
bb env-catalog get OPENAI_API_KEY --raw

# Save a new secret
bb env-catalog set STRIPE_SECRET_KEY sk_live_... --service Stripe --desc "Live Stripe secret"

# Securely request credentials from the user via in-app masked form
bb env-catalog request OPENAI_API_KEY --purpose "Configure server" --describe OPENAI_API_KEY "OpenAI key"

# Request multiple keys
bb env-catalog request OPENAI_API_KEY ANTHROPIC_API_KEY --purpose "Configure AI providers"

# Delete a secret
bb env-catalog delete STRIPE_SECRET_KEY

# Export to .env format
bb env-catalog export --format env > .env
```
