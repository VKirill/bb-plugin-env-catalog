import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi, type PluginCliContext } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import { z } from "zod";
import { ENV_REQUEST_RENDERER_ID, envRequestResponseSchema } from "./contracts.js";

export interface EnvRecord {
  name: string;
  value: string;
  description?: string;
  service?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EnvSummary {
  name: string;
  maskedValue: string;
  description?: string | null;
  service?: string | null;
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const summarySchema = z.object({
  name: z.string(),
  maskedValue: z.string(),
  description: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const rpcContract = defineRpcContract({
  env_list: {
    input: z.object({
      query: z.string().nullable().optional(),
    }),
    output: z.object({
      variables: z.array(summarySchema),
    }),
  },
  env_get_value: {
    input: z.object({
      name: z.string(),
    }),
    output: z.object({
      name: z.string(),
      value: z.string(),
      description: z.string().nullable().optional(),
      service: z.string().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
    }),
  },
  env_save: {
    input: z.object({
      name: z.string().trim().min(1),
      value: z.string(),
      description: z.string().nullable().optional(),
      service: z.string().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      name: z.string(),
    }),
  },
  env_delete: {
    input: z.object({
      name: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
    }),
  },
  env_export: {
    input: z.object({
      format: z.enum(["env", "json"]),
    }),
    output: z.object({
      content: z.string(),
    }),
  },
  env_import: {
    input: z.object({
      content: z.string(),
      format: z.enum(["env", "json"]),
      overwrite: z.boolean().default(true),
    }),
    output: z.object({
      importedCount: z.number(),
    }),
  },
  env_import_machine_env: {
    input: z.null(),
    output: z.object({
      importedCount: z.number(),
    }),
  },
});

export const ENV_CATALOG_CHANGED = "env-catalog:changed";

function maskValue(val: string): string {
  if (!val || val.length === 0) return "";
  if (val.length <= 8) return "••••••••";
  const start = val.slice(0, 4);
  const end = val.slice(-4);
  return `${start}••••••••${end}`;
}

function inferService(name: string): string | undefined {
  const upper = name.toUpperCase();
  if (upper.includes("OPENAI")) return "OpenAI";
  if (upper.includes("DEEPSEEK")) return "DeepSeek";
  if (upper.includes("FAL")) return "fal.ai";
  if (upper.includes("GH_") || upper.includes("GITHUB")) return "GitHub";
  if (upper.includes("GROQ")) return "Groq";
  if (upper.includes("KIE")) return "Kie.ai";
  if (upper.includes("MUTAGEN")) return "Mutagen";
  if (upper.includes("TG_") || upper.includes("TELEGRAM")) return "Telegram";
  if (upper.includes("XMLSTOCK")) return "xmlstock";
  if (upper.includes("GEMINI") || upper.includes("GOOGLE")) return "Google Gemini";
  if (upper.includes("ALPHAXIV")) return "alphaXiv";
  return undefined;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("Starting Env Catalog plugin");

  // Setup encryption master key in plugin directory
  const dataDir =
    bb.server.experimental_dataDir ??
    join(process.env.HOME ?? "~", ".bb");
  const pluginStorageDir = join(dataDir, "plugins", "env-catalog");
  mkdirSync(pluginStorageDir, { recursive: true });

  const keyPath = join(pluginStorageDir, "master.key");
  let masterKey: Buffer;
  if (existsSync(keyPath)) {
    masterKey = readFileSync(keyPath);
    if (masterKey.length !== 32) {
      masterKey = randomBytes(32);
      writeFileSync(keyPath, masterKey, { mode: 0o600 });
    }
  } else {
    masterKey = randomBytes(32);
    writeFileSync(keyPath, masterKey, { mode: 0o600 });
  }

  function encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    let encrypted = cipher.update(plainText, "utf8", "base64");
    encrypted += cipher.final("base64");
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
  }

  function decrypt(encryptedPayload: string): string {
    const parts = encryptedPayload.split(":");
    if (parts.length !== 3) {
      return encryptedPayload;
    }
    const [ivB64, tagB64, cipherText] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(cipherText, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // Database initialization
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS env_variables (
      name TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      description TEXT,
      service TEXT,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_env_service ON env_variables(service);`,
  ]);

  interface DbRow {
    name: string;
    encrypted_value: string;
    description: string | null;
    service: string | null;
    tags: string | null;
    created_at: string;
    updated_at: string;
  }

  function parseTags(raw: string | null): string[] | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function listSummaries(searchQuery?: string | null): Promise<EnvSummary[]> {
    let rows: DbRow[];
    if (searchQuery && searchQuery.trim().length > 0) {
      const pattern = `%${searchQuery.trim().toLowerCase()}%`;
      const stmt = db.prepare<[string, string, string], DbRow>(
        `SELECT * FROM env_variables 
         WHERE LOWER(name) LIKE ? OR LOWER(service) LIKE ? OR LOWER(description) LIKE ?
         ORDER BY name ASC`
      );
      rows = stmt.all(pattern, pattern, pattern);
    } else {
      const stmt = db.prepare<[], DbRow>(
        `SELECT * FROM env_variables ORDER BY name ASC`
      );
      rows = stmt.all();
    }

    return rows.map((row) => {
      let decrypted = "";
      try {
        decrypted = decrypt(row.encrypted_value);
      } catch {
        decrypted = "••••";
      }
      return {
        name: row.name,
        maskedValue: maskValue(decrypted),
        description: row.description ?? null,
        service: row.service ?? null,
        tags: parseTags(row.tags) ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  async function getVariable(name: string): Promise<EnvRecord | null> {
    const stmt = db.prepare<[string], DbRow>(
      `SELECT * FROM env_variables WHERE name = ?`
    );
    const row = stmt.get(name.trim());
    if (!row) return null;

    return {
      name: row.name,
      value: decrypt(row.encrypted_value),
      description: row.description ?? undefined,
      service: row.service ?? undefined,
      tags: parseTags(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async function saveVariable(params: {
    name: string;
    value: string;
    description?: string | null;
    service?: string | null;
    tags?: string[] | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const cleanName = params.name.trim();
    const encrypted = encrypt(params.value);
    const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

    const existing = db
      .prepare<[string], { created_at: string }>(
        `SELECT created_at FROM env_variables WHERE name = ?`
      )
      .get(cleanName);

    const createdAt = existing ? existing.created_at : now;

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO env_variables 
       (name, encrypted_value, description, service, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      cleanName,
      encrypted,
      params.description?.trim() || null,
      params.service?.trim() || null,
      tagsJson,
      createdAt,
      now
    );

    bb.realtime.publish(ENV_CATALOG_CHANGED, { name: cleanName, action: "save" });
  }

  async function deleteVariable(name: string): Promise<boolean> {
    const cleanName = name.trim();
    const stmt = db.prepare(`DELETE FROM env_variables WHERE name = ?`);
    const info = stmt.run(cleanName);
    const deleted = info.changes > 0;
    if (deleted) {
      bb.realtime.publish(ENV_CATALOG_CHANGED, { name: cleanName, action: "delete" });
    }
    return deleted;
  }

  async function exportAll(format: "env" | "json"): Promise<string> {
    const stmt = db.prepare<[], DbRow>(
      `SELECT * FROM env_variables ORDER BY name ASC`
    );
    const rows = stmt.all();
    const records = rows.map((r) => ({
      name: r.name,
      value: decrypt(r.encrypted_value),
      description: r.description ?? undefined,
      service: r.service ?? undefined,
    }));

    if (format === "json") {
      return JSON.stringify(records, null, 2);
    }

    const lines: string[] = [];
    for (const r of records) {
      if (r.description) {
        lines.push(`# ${r.description}${r.service ? ` (${r.service})` : ""}`);
      }
      const escaped =
        r.value.includes(" ") || r.value.includes("\n") || r.value.includes('"')
          ? JSON.stringify(r.value)
          : r.value;
      lines.push(`${r.name}=${escaped}`);
    }
    return lines.join("\n");
  }

  async function importContent(
    content: string,
    format: "env" | "json",
    overwrite = true
  ): Promise<number> {
    let count = 0;
    if (format === "json") {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.name === "string" && typeof item.value === "string") {
              if (!overwrite) {
                const existing = await getVariable(item.name);
                if (existing) continue;
              }
              await saveVariable({
                name: item.name,
                value: item.value,
                description: item.description,
                service: item.service,
                tags: item.tags,
              });
              count++;
            }
          }
        }
      } catch (err) {
        throw new Error(`Invalid JSON format: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      const lines = content.split("\n");
      let currentComment: string | undefined;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          currentComment = undefined;
          continue;
        }
        if (line.startsWith("#")) {
          currentComment = line.replace(/^#+\s*/, "").trim();
          continue;
        }
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx).trim();
          let rawVal = line.slice(eqIdx + 1).trim();

          if (
            (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
            (rawVal.startsWith("'") && rawVal.endsWith("'"))
          ) {
            rawVal = rawVal.slice(1, -1);
          }

          if (!overwrite) {
            const existing = await getVariable(key);
            if (existing) {
              currentComment = undefined;
              continue;
            }
          }

          await saveVariable({
            name: key,
            value: rawVal,
            description: currentComment,
          });
          count++;
          currentComment = undefined;
        }
      }
    }

    if (count > 0) {
      bb.realtime.publish(ENV_CATALOG_CHANGED, { action: "import", count });
    }
    return count;
  }

  function importFromMachineEnvironment(): number {
    const keyFile = join(dataDir, "machine-environment-key");
    const mainDbFile = join(dataDir, "bb.db");

    if (!existsSync(keyFile) || !existsSync(mainDbFile)) {
      return 0;
    }

    const keyHex = readFileSync(keyFile, "utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(keyHex)) {
      return 0;
    }
    const key = Buffer.from(keyHex, "hex");

    const mainDb = new Database(mainDbFile, { readonly: true });
    try {
      const rows = mainDb
        .prepare(
          "SELECT key, value FROM app_settings_values WHERE key LIKE 'machineEnvironment:%'"
        )
        .all() as Array<{ key: string; value: string }>;

      let count = 0;
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.value);
          if (!parsed.name || !parsed.ciphertext) continue;

          const encrypted = Buffer.from(parsed.ciphertext, "base64");
          const iv = encrypted.subarray(0, 12);
          const authTag = encrypted.subarray(12, 28);
          const ciphertext = encrypted.subarray(28);

          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAAD(Buffer.from(parsed.name));
          decipher.setAuthTag(authTag);
          const val = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
          ]).toString("utf8");

          const service = inferService(parsed.name);
          const description =
            parsed.note || (service ? `${service} API key / credential` : undefined);

          saveVariable({
            name: parsed.name,
            value: val,
            description,
            service,
          });
          count++;
        } catch (err) {
          bb.log.warn(`Failed to decrypt machine environment variable: ${String(err)}`);
        }
      }
      if (count > 0) {
        bb.realtime.publish(ENV_CATALOG_CHANGED, {
          action: "import-machine-env",
          count,
        });
      }
      return count;
    } finally {
      mainDb.close();
    }
  }

  // Register RPC Handlers for Frontend UI
  bb.rpc.register(rpcContract, {
    env_list: async ({ query }) => ({
      variables: await listSummaries(query),
    }),
    env_get_value: async ({ name }) => {
      const record = await getVariable(name);
      if (!record) {
        throw new Error(`Secret '${name}' not found.`);
      }
      return {
        name: record.name,
        value: record.value,
        description: record.description ?? null,
        service: record.service ?? null,
        tags: record.tags ?? null,
      };
    },
    env_save: async (params) => {
      await saveVariable(params);
      return { success: true, name: params.name.trim() };
    },
    env_delete: async ({ name }) => {
      const success = await deleteVariable(name);
      return { success };
    },
    env_export: async ({ format }) => ({
      content: await exportAll(format),
    }),
    env_import: async ({ content, format, overwrite }) => ({
      importedCount: await importContent(content, format, overwrite),
    }),
    env_import_machine_env: async () => ({
      importedCount: importFromMachineEnvironment(),
    }),
  });

  // Register Agent Tools
  bb.agents.registerTool({
    name: "env_get",
    description: "Retrieve an environment variable, token, or API key from the Env Catalog by its exact name.",
    parameters: z.object({
      name: z.string().describe("Exact name of the variable (e.g. OPENAI_API_KEY, TAVILY_API_KEY)"),
    }),
    presentation: {
      label: {
        pending: "Reading secret from Env Catalog",
        completed: "Read secret from Env Catalog",
      },
    },
    async execute({ name }) {
      const item = await getVariable(name);
      if (!item) {
        return JSON.stringify({
          found: false,
          name,
          message: `Variable '${name}' is not found in Env Catalog. Call 'env_list' to see available keys.`,
        });
      }
      return JSON.stringify({
        found: true,
        name: item.name,
        value: item.value,
        description: item.description,
        service: item.service,
      });
    },
  });

  bb.agents.registerTool({
    name: "env_list",
    description: "List all environment variable and secret names in the Env Catalog. Values are omitted for token efficiency.",
    parameters: z.object({
      query: z.string().optional().describe("Optional filter by variable name, service, or description"),
    }),
    presentation: {
      label: {
        pending: "Listing keys in Env Catalog",
        completed: "Listed keys in Env Catalog",
      },
    },
    async execute({ query }) {
      const summaries = await listSummaries(query);
      return JSON.stringify({
        count: summaries.length,
        variables: summaries.map((s) => ({
          name: s.name,
          service: s.service,
          description: s.description,
          tags: s.tags,
          updatedAt: s.updatedAt,
        })),
      });
    },
  });

  bb.agents.registerTool({
    name: "env_set",
    description: "Store or update an environment variable or API key in the Env Catalog for reuse across sessions and machines.",
    parameters: z.object({
      name: z.string().describe("Variable name (e.g. OPENAI_API_KEY, STRIPE_SECRET_KEY)"),
      value: z.string().describe("The secret value, API key, or token"),
      description: z.string().optional().describe("Short explanation of what this key is for"),
      service: z.string().optional().describe("Service name (e.g. OpenAI, Anthropic, Tavily, Google)"),
      tags: z.array(z.string()).optional().describe("Optional tags (e.g. ['ai', 'search'])"),
    }),
    presentation: {
      label: {
        pending: "Saving secret to Env Catalog",
        completed: "Saved secret to Env Catalog",
      },
    },
    async execute({ name, value, description, service, tags }) {
      await saveVariable({ name, value, description, service, tags });
      return JSON.stringify({
        success: true,
        name: name.trim(),
        message: `Saved '${name.trim()}' in Env Catalog.`,
      });
    },
  });

  bb.agents.registerTool({
    name: "env_delete",
    description: "Delete an environment variable from the Env Catalog.",
    parameters: z.object({
      name: z.string().describe("Variable name to delete"),
    }),
    presentation: {
      label: {
        pending: "Deleting secret from Env Catalog",
        completed: "Deleted secret from Env Catalog",
      },
    },
    async execute({ name }) {
      const deleted = await deleteVariable(name);
      return JSON.stringify({
        success: deleted,
        name,
        message: deleted
          ? `Deleted '${name}' from Env Catalog.`
          : `Variable '${name}' not found.`,
      });
    },
  });

  async function requestSecretsFromUser(options: {
    threadId: string;
    fields: Array<{ name: string; description?: string | null; service?: string | null }>;
    purpose?: string | null;
    signal?: AbortSignal;
  }): Promise<
    | { outcome: "submitted"; values: Record<string, string> }
    | { outcome: "cancelled"; reason: string }
  > {
    const title =
      options.fields.length === 1
        ? `Add ${options.fields[0].name} to Env Catalog`
        : `Add secrets to Env Catalog (${options.fields.length} variables)`;

    const result = await bb.ui.requestInput(
      {
        threadId: options.threadId,
        rendererId: ENV_REQUEST_RENDERER_ID,
        title,
        payload: {
          purpose: options.purpose ?? null,
          fields: options.fields.map((f) => ({
            name: f.name,
            description: f.description ?? null,
            service: f.service ?? inferService(f.name) ?? null,
          })),
        },
      },
      { signal: options.signal }
    );

    if (result.outcome === "cancelled") {
      return { outcome: "cancelled", reason: result.reason };
    }

    const parsed = envRequestResponseSchema.safeParse(result.value);
    if (!parsed.success) {
      throw new Error("Invalid response received from secret input form.");
    }

    return { outcome: "submitted", values: parsed.data.values };
  }

  bb.agents.registerTool({
    name: "env_request",
    description:
      "Securely prompt the user with a masked in-app input form to enter one or more API keys or secrets. Use this whenever an API key or credential is required but not found in the Env Catalog, instead of asking the user in plain chat. Values are encrypted and saved directly to the Env Catalog without appearing in chat history.",
    parameters: z.object({
      name: z
        .string()
        .optional()
        .describe(
          "Variable name to request (e.g. OPENAI_API_KEY). If requesting multiple, use 'names' or comma-separated names."
        ),
      names: z
        .array(z.string())
        .optional()
        .describe(
          "List of variable names if requesting multiple at once (e.g. ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'])"
        ),
      purpose: z
        .string()
        .optional()
        .describe(
          "Short reason why this API key is needed (shown to the user in the prompt dialog)"
        ),
      description: z
        .string()
        .optional()
        .describe("Short description of what the key is"),
      service: z
        .string()
        .optional()
        .describe("Service name (e.g. OpenAI, Anthropic, Tavily, Google)"),
    }),
    presentation: {
      label: {
        pending: "Requesting secret from user via secure form",
        completed: "Requested secret from user via secure form",
      },
    },
    async execute(params, ctx) {
      const targetThreadId = ctx.threadId || process.env.BB_THREAD_ID;
      if (!targetThreadId) {
        return JSON.stringify({
          success: false,
          error: "Cannot request secrets without an active thread context.",
        });
      }

      const rawNames: string[] = [];
      if (params.names && Array.isArray(params.names) && params.names.length > 0) {
        for (const n of params.names) {
          if (typeof n === "string" && n.trim()) rawNames.push(n.trim());
        }
      } else if (params.name && params.name.trim()) {
        const split = params.name.split(",").map((s) => s.trim()).filter(Boolean);
        rawNames.push(...split);
      }

      if (rawNames.length === 0) {
        return JSON.stringify({
          success: false,
          error: "Specify at least one variable name to request (e.g. name: 'OPENAI_API_KEY').",
        });
      }

      const fields = rawNames.map((name) => ({
        name,
        description: params.description ?? null,
        service: params.service ?? inferService(name) ?? null,
      }));

      const promptResult = await requestSecretsFromUser({
        threadId: targetThreadId,
        fields,
        purpose: params.purpose ?? null,
        signal: ctx.signal,
      });

      if (promptResult.outcome === "cancelled") {
        return JSON.stringify({
          success: false,
          cancelled: true,
          reason: promptResult.reason,
          message: `The user dismissed or cancelled the secret input form (${promptResult.reason}). Proceed with available alternatives or ask how to proceed.`,
        });
      }

      const savedNames: string[] = [];
      for (const [key, val] of Object.entries(promptResult.values)) {
        const fieldMeta = fields.find((f) => f.name === key);
        await saveVariable({
          name: key,
          value: val,
          description: fieldMeta?.description ?? undefined,
          service: fieldMeta?.service ?? undefined,
        });
        savedNames.push(key);
      }

      return JSON.stringify({
        success: true,
        saved: savedNames,
        message: `Successfully received and encrypted ${savedNames.join(", ")} in Env Catalog. The values are preserved for future use and never disclosed in chat history.`,
      });
    },
  });

  // Dynamic Instructions for Agents
  bb.agents.contributeInstructions(() => {
    return "Env Catalog is active. When an API key, token, or secret is needed for an external service or script, check available credentials using `env_list` and retrieve the required value with `env_get`. If a required key is missing, NEVER ask the user to paste it into chat; instead, call `env_request` to open a secure masked input form in the UI. The secret will be encrypted and stored directly in the Env Catalog without leaking into chat history. When the user provides a new credential in conversation, store it using `env_set`.";
  });

  // CLI Command Registration
  const usage = [
    "Env Catalog CLI",
    "",
    "Usage:",
    "  bb env-catalog list [--query <text>] [--json]",
    "  bb env-catalog get <NAME> [--raw]",
    "  bb env-catalog set <NAME> <VALUE> [--desc <text>] [--service <text>]",
    "  bb env-catalog request <NAME...> [--purpose <text>] [--describe <NAME> <text>] [--service <text>]",
    "  bb env-catalog delete <NAME>",
    "  bb env-catalog export [--format env|json]",
    "  bb env-catalog import-machine-env",
  ].join("\n");

  function parseCliRequest(args: string[]): {
    names: string[];
    purpose: string | null;
    descriptions: Map<string, string>;
    services: Map<string, string>;
    defaultService: string | null;
    threadId: string | null;
  } {
    const names: string[] = [];
    const descriptions = new Map<string, string>();
    const services = new Map<string, string>();
    let defaultService: string | null = null;
    let purpose: string | null = null;
    let threadId: string | null = null;

    for (let i = 0; i < args.length; i++) {
      const token = args[i] ?? "";
      if (!token.startsWith("--")) {
        names.push(token.trim());
        continue;
      }
      if (token === "--thread") {
        i++;
        threadId = args[i]?.trim() ?? null;
        continue;
      }
      if (token === "--purpose") {
        i++;
        purpose = args[i]?.trim() ?? null;
        continue;
      }
      if (token === "--service") {
        i++;
        const next1 = args[i]?.trim();
        const next2 = args[i + 1]?.trim();
        if (next1 && next2 && !next2.startsWith("--")) {
          services.set(next1, next2);
          i++;
        } else if (next1) {
          defaultService = next1;
        }
        continue;
      }
      if (token === "--describe") {
        const varName = args[++i]?.trim();
        const desc = args[++i]?.trim();
        if (varName && desc) {
          descriptions.set(varName, desc);
        }
        continue;
      }
    }

    return { names, purpose, descriptions, services, defaultService, threadId };
  }

  bb.cli.register({
    name: "env-catalog",
    summary: "Manage encrypted API keys and environment variables in the Env Catalog",
    commands: [
      {
        name: "list",
        summary: "List stored environment variables",
        usage: "bb env-catalog list [--query <text>] [--json]",
      },
      {
        name: "get",
        summary: "Get decrypted value of a secret",
        usage: "bb env-catalog get <NAME> [--raw]",
      },
      {
        name: "set",
        summary: "Store or update a secret",
        usage: "bb env-catalog set <NAME> <VALUE> [--desc <text>] [--service <text>]",
      },
      {
        name: "request",
        summary: "Securely request secrets from user via masked form in thread",
        usage:
          "bb env-catalog request <NAME...> [--purpose <text>] [--describe <NAME> <text>]... [--service <text>]",
      },
      {
        name: "delete",
        summary: "Delete a secret",
        usage: "bb env-catalog delete <NAME>",
      },
      {
        name: "export",
        summary: "Export secrets as .env or JSON",
        usage: "bb env-catalog export [--format env|json]",
      },
      {
        name: "import-machine-env",
        summary: "Import and decrypt all keys from BB Machine Environment",
        usage: "bb env-catalog import-machine-env",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const raw = argv.includes("--raw");
      const filtered = argv.filter((a) => a !== "--json" && a !== "--raw");
      const [command, ...args] = filtered;

      const reply = (data: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(data, null, 2) : text,
      });

      const error = (msg: string) => ({
        exitCode: 1,
        stderr: msg,
      });

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };

        case "list": {
          let q: string | undefined;
          const qIdx = args.indexOf("--query");
          if (qIdx !== -1 && args[qIdx + 1]) {
            q = args[qIdx + 1];
          }
          const items = await listSummaries(q);
          if (json) {
            return reply(items, "");
          }
          if (items.length === 0) {
            return reply([], "No environment variables found.");
          }
          const table = items
            .map(
              (it) =>
                `${it.name.padEnd(28)} ${it.maskedValue.padEnd(16)} ${
                  it.service ? `[${it.service}] ` : ""
                }${it.description || ""}`
            )
            .join("\n");
          return reply(items, table);
        }

        case "get": {
          const name = args[0];
          if (!name) return error("Variable name required: bb env-catalog get <NAME>");
          const item = await getVariable(name);
          if (!item) return error(`Variable '${name}' not found.`);
          if (raw) {
            return { exitCode: 0, stdout: item.value };
          }
          return reply(item, `${item.name}=${item.value}`);
        }

        case "set": {
          const name = args[0];
          const value = args[1];
          if (!name || value === undefined) {
            return error("Name and value required: bb env-catalog set <NAME> <VALUE>");
          }
          let description: string | undefined;
          let service: string | undefined;

          const descIdx = args.indexOf("--desc");
          if (descIdx !== -1 && args[descIdx + 1]) description = args[descIdx + 1];

          const srvIdx = args.indexOf("--service");
          if (srvIdx !== -1 && args[srvIdx + 1]) service = args[srvIdx + 1];

          await saveVariable({ name, value, description, service });
          return reply({ success: true, name }, `Saved '${name}' to Env Catalog.`);
        }

        case "request": {
          const { names, purpose, descriptions, services, defaultService, threadId } =
            parseCliRequest(args);
          const targetThreadId = threadId || ctx.threadId || process.env.BB_THREAD_ID;
          if (!targetThreadId) {
            return error(
              "bb env-catalog request must be run from an active BB thread where the secure form can be displayed, or specify --thread <id>."
            );
          }
          if (names.length === 0) {
            return error(
              "Specify at least one variable name: bb env-catalog request <NAME...> [--purpose <text>]"
            );
          }

          const fields = names.map((name) => ({
            name,
            description: descriptions.get(name) ?? null,
            service:
              services.get(name) ?? defaultService ?? inferService(name) ?? null,
          }));

          const promptResult = await requestSecretsFromUser({
            threadId: targetThreadId,
            fields,
            purpose,
            signal: ctx.signal,
          });

          if (promptResult.outcome === "cancelled") {
            return error(`Secret request cancelled (${promptResult.reason}).`);
          }

          const savedNames: string[] = [];
          for (const [key, val] of Object.entries(promptResult.values)) {
            const fieldMeta = fields.find((f) => f.name === key);
            await saveVariable({
              name: key,
              value: val,
              description: fieldMeta?.description ?? undefined,
              service: fieldMeta?.service ?? undefined,
            });
            savedNames.push(key);
          }

          return reply(
            { success: true, saved: savedNames },
            `Saved ${savedNames.length} secret${savedNames.length === 1 ? "" : "s"} to Env Catalog: ${savedNames.join(", ")}.\n`
          );
        }

        case "delete": {
          const name = args[0];
          if (!name) return error("Variable name required: bb env-catalog delete <NAME>");
          const deleted = await deleteVariable(name);
          if (!deleted) return error(`Variable '${name}' not found.`);
          return reply({ success: true, name }, `Deleted '${name}' from Env Catalog.`);
        }

        case "export": {
          let fmt: "env" | "json" = "env";
          const fmtIdx = args.indexOf("--format");
          if (fmtIdx !== -1 && args[fmtIdx + 1] === "json") {
            fmt = "json";
          }
          const content = await exportAll(fmt);
          return { exitCode: 0, stdout: content };
        }

        case "import-machine-env": {
          const count = importFromMachineEnvironment();
          return reply(
            { importedCount: count },
            `Successfully imported and decrypted ${count} keys from BB Machine Environment.`
          );
        }
      }

      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("Env Catalog disposed");
  });
}
