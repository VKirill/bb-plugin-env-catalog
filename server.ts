import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import { z } from "zod";
import { ENV_REQUEST_RENDERER_ID, envRequestResponseSchema } from "./contracts.js";
import {
  accessFromFlat,
  credentialKindSchema,
  maskAccess,
  packStoredValue,
  parseKind,
  revealText,
  unpackStoredValue,
  type CredentialKind,
} from "./kinds.js";

export interface EnvRecord {
  name: string;
  kind: CredentialKind;
  value: string | null;
  access: ReturnType<typeof unpackStoredValue>["access"];
  stored: string;
  description?: string;
  service?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EnvSummary {
  name: string;
  kind: CredentialKind;
  maskedValue: string;
  description?: string | null;
  service?: string | null;
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const summarySchema = z.object({
  name: z.string(),
  kind: credentialKindSchema,
  maskedValue: z.string(),
  description: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const accessSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const rpcContract = defineRpcContract({
  env_list: {
    input: z.object({
      query: z.string().nullable().optional(),
      kind: credentialKindSchema.nullable().optional(),
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
      kind: credentialKindSchema,
      value: z.string().nullable(),
      access: z.unknown().nullable(),
      reveal: z.string(),
      description: z.string().nullable().optional(),
      service: z.string().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
    }),
  },
  env_save: {
    input: z.object({
      name: z.string().trim().min(1),
      kind: credentialKindSchema.nullable().optional(),
      value: z.string().nullable().optional(),
      access: accessSchema,
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

function inferService(name: string, kind?: CredentialKind): string | undefined {
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
  if (upper.includes("TAVILY")) return "Tavily";
  if (kind === "ftp" || upper.includes("FTP") || upper.includes("SFTP")) return "FTP";
  if (kind === "ssh" || upper.includes("SSH")) return "SSH";
  if (upper.includes("OVH")) return "OVH";
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

  const columns = db
    .prepare("PRAGMA table_info(env_variables)")
    .all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "kind")) {
    db.exec(
      `ALTER TABLE env_variables ADD COLUMN kind TEXT NOT NULL DEFAULT 'secret';`,
    );
  }

  interface DbRow {
    name: string;
    encrypted_value: string;
    description: string | null;
    service: string | null;
    tags: string | null;
    kind: string | null;
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

  async function listSummaries(
    searchQuery?: string | null,
    kindFilter?: CredentialKind | null,
  ): Promise<EnvSummary[]> {
    let rows: DbRow[];
    if (searchQuery && searchQuery.trim().length > 0) {
      const pattern = `%${searchQuery.trim().toLowerCase()}%`;
      const stmt = db.prepare<[string, string, string, string], DbRow>(
        `SELECT * FROM env_variables 
         WHERE LOWER(name) LIKE ? OR LOWER(service) LIKE ? OR LOWER(description) LIKE ? OR LOWER(kind) LIKE ?
         ORDER BY name ASC`
      );
      rows = stmt.all(pattern, pattern, pattern, pattern);
    } else {
      const stmt = db.prepare<[], DbRow>(
        `SELECT * FROM env_variables ORDER BY name ASC`
      );
      rows = stmt.all();
    }

    return rows
      .map((row) => {
        const storedKind = parseKind(row.kind);
        let decrypted = "";
        try {
          decrypted = decrypt(row.encrypted_value);
        } catch {
          decrypted = "";
        }
        const unpacked = unpackStoredValue(storedKind, decrypted || "••••");
        return {
          name: row.name,
          kind: unpacked.kind,
          maskedValue: decrypted ? maskAccess(storedKind, decrypted) : "••••••••",
          description: row.description ?? null,
          service: row.service ?? null,
          tags: parseTags(row.tags) ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      })
      .filter((row) => (kindFilter ? row.kind === kindFilter : true));
  }

  async function getVariable(name: string): Promise<EnvRecord | null> {
    const stmt = db.prepare<[string], DbRow>(
      `SELECT * FROM env_variables WHERE name = ?`
    );
    const row = stmt.get(name.trim());
    if (!row) return null;

    const stored = decrypt(row.encrypted_value);
    const unpacked = unpackStoredValue(parseKind(row.kind), stored);
    return {
      name: row.name,
      kind: unpacked.kind,
      value: unpacked.value,
      access: unpacked.access,
      stored,
      description: row.description ?? undefined,
      service: row.service ?? undefined,
      tags: parseTags(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async function saveVariable(params: {
    name: string;
    kind?: CredentialKind | null;
    value?: string | null;
    access?: unknown;
    description?: string | null;
    service?: string | null;
    tags?: string[] | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const cleanName = params.name.trim();
    const kind = parseKind(params.kind ?? "secret");
    const packed = packStoredValue(kind, params.value ?? undefined, params.access);
    const encrypted = encrypt(packed);
    const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

    const existing = db
      .prepare<[string], { created_at: string }>(
        `SELECT created_at FROM env_variables WHERE name = ?`
      )
      .get(cleanName);

    const createdAt = existing ? existing.created_at : now;

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO env_variables 
       (name, encrypted_value, description, service, tags, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      cleanName,
      encrypted,
      params.description?.trim() || null,
      params.service?.trim() || inferService(cleanName, kind) || null,
      tagsJson,
      kind,
      createdAt,
      now
    );

    bb.realtime.publish(ENV_CATALOG_CHANGED, { name: cleanName, action: "save", kind });
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
    const records = rows.map((r) => {
      const stored = decrypt(r.encrypted_value);
      const unpacked = unpackStoredValue(parseKind(r.kind), stored);
      return {
        name: r.name,
        kind: unpacked.kind,
        value: unpacked.value,
        access: unpacked.access,
        description: r.description ?? undefined,
        service: r.service ?? undefined,
      };
    });

    if (format === "json") {
      return JSON.stringify(records, null, 2);
    }

    const lines: string[] = [];
    for (const r of records) {
      if (r.description || r.kind !== "secret") {
        lines.push(
          `# ${r.description ?? r.kind}${r.service ? ` (${r.service})` : ""} [${r.kind}]`,
        );
      }
      const raw =
        r.kind === "secret"
          ? (r.value ?? "")
          : JSON.stringify({ v: 1, kind: r.kind, access: r.access });
      const escaped =
        raw.includes(" ") || raw.includes("\n") || raw.includes('"')
          ? JSON.stringify(raw)
          : raw;
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
            if (item && typeof item.name === "string") {
              if (!overwrite) {
                const existing = await getVariable(item.name);
                if (existing) continue;
              }
              const kind = parseKind(item.kind);
              if (kind === "secret" && typeof item.value !== "string") continue;
              await saveVariable({
                name: item.name,
                kind,
                value: typeof item.value === "string" ? item.value : undefined,
                access: item.access,
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

  async function importFromMachineEnvironment(): Promise<number> {
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

          await saveVariable({
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
    env_list: async ({ query, kind }) => ({
      variables: await listSummaries(query, kind),
    }),
    env_get_value: async ({ name }) => {
      const record = await getVariable(name);
      if (!record) {
        throw new Error(`Secret '${name}' not found.`);
      }
      return {
        name: record.name,
        kind: record.kind,
        value: record.value,
        access: record.access,
        reveal: revealText(record.kind, record.stored),
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
      importedCount: await importFromMachineEnvironment(),
    }),
  });

  // Register Agent Tools
  bb.agents.registerTool({
    name: "env_get",
    description:
      "Retrieve a credential from Env Catalog by exact name: API key, FTP/SFTP account, SSH key, or site login. Do not echo the secret in chat.",
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
        kind: item.kind,
        value: item.value,
        access: item.access,
        description: item.description,
        service: item.service,
      });
    },
  });

  bb.agents.registerTool({
    name: "env_list",
    description:
      "List credential names in Env Catalog (API keys, FTP, SSH, logins). Values are omitted. Filter with query or kind.",
    parameters: z.object({
      query: z.string().optional().describe("Optional filter by name, service, kind, or description"),
      kind: credentialKindSchema
        .optional()
        .describe("Optional type filter: secret, ftp, ssh, or login"),
    }),
    presentation: {
      label: {
        pending: "Listing keys in Env Catalog",
        completed: "Listed keys in Env Catalog",
      },
    },
    async execute({ query, kind }) {
      const summaries = await listSummaries(query, kind);
      return JSON.stringify({
        count: summaries.length,
        variables: summaries.map((s) => ({
          name: s.name,
          kind: s.kind,
          service: s.service,
          description: s.description,
          summary: s.maskedValue,
          tags: s.tags,
          updatedAt: s.updatedAt,
        })),
      });
    },
  });

  bb.agents.registerTool({
    name: "env_set",
    description:
      "Store or update a credential in Env Catalog: API key (kind=secret), FTP/FTPS/SFTP, SSH host+private key, or a site login. Available to every enrolled machine.",
    parameters: z.object({
      name: z.string().describe("Stable name (e.g. OPENAI_API_KEY, OVH_SSH, FTP_OHMYSEO)"),
      kind: credentialKindSchema
        .optional()
        .describe("secret (default), ftp, ssh, or login"),
      value: z
        .string()
        .optional()
        .describe("Secret string when kind is secret (API key, token, PEM as a single value)"),
      description: z.string().optional().describe("Short note"),
      service: z.string().optional().describe("Service label (OpenAI, OVH, Beget…)"),
      tags: z.array(z.string()).optional(),
      protocol: z.enum(["ftp", "ftps", "sftp"]).optional().describe("FTP kind: protocol"),
      host: z.string().optional().describe("FTP/SSH/login host"),
      port: z.number().optional().describe("Port; default 21 for FTP, 22 for SSH/SFTP"),
      username: z.string().optional(),
      password: z.string().optional().describe("FTP or login password"),
      privateKey: z.string().optional().describe("SSH private key PEM / OpenSSH text"),
      passphrase: z.string().optional().describe("Optional passphrase for the SSH key"),
      fingerprint: z.string().optional().describe("Optional SHA-256 host key fingerprint"),
      root: z.string().optional().describe("FTP remote root path"),
      url: z.string().optional().describe("Login panel URL"),
    }),
    presentation: {
      label: {
        pending: "Saving secret to Env Catalog",
        completed: "Saved secret to Env Catalog",
      },
    },
    async execute({
      name,
      kind,
      value,
      description,
      service,
      tags,
      protocol,
      host,
      port,
      username,
      password,
      privateKey,
      passphrase,
      fingerprint,
      root,
      url,
    }) {
      const resolved = parseKind(kind ?? "secret");
      const access =
        resolved === "secret"
          ? undefined
          : accessFromFlat(resolved, {
              protocol,
              host,
              port,
              username,
              password,
              privateKey,
              passphrase,
              fingerprint,
              root,
              url,
            });
      await saveVariable({
        name,
        kind: resolved,
        value,
        access,
        description,
        service,
        tags,
      });
      return JSON.stringify({
        success: true,
        name: name.trim(),
        kind: resolved,
        message: `Saved '${name.trim()}' (${resolved}) in Env Catalog.`,
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
    fields: Array<{
      name: string;
      kind?: CredentialKind | null;
      description?: string | null;
      service?: string | null;
    }>;
    purpose?: string | null;
    signal?: AbortSignal;
  }): Promise<
    | { outcome: "submitted"; payload: import("./contracts.js").EnvRequestResponse }
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
            kind: parseKind(f.kind ?? "secret"),
            description: f.description ?? null,
            service: f.service ?? inferService(f.name, parseKind(f.kind ?? "secret")) ?? null,
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

    return { outcome: "submitted", payload: parsed.data };
  }

  async function persistRequestPayload(
    payload: import("./contracts.js").EnvRequestResponse,
    fields: Array<{ name: string; kind?: CredentialKind | null; description?: string | null; service?: string | null }>,
  ): Promise<string[]> {
    const savedNames: string[] = [];
    if (payload.entries && payload.entries.length > 0) {
      for (const entry of payload.entries) {
        const fieldMeta = fields.find((f) => f.name === entry.name);
        await saveVariable({
          name: entry.name,
          kind: parseKind(entry.kind ?? fieldMeta?.kind ?? "secret"),
          value: entry.value,
          access: entry.access,
          description: entry.description ?? fieldMeta?.description ?? undefined,
          service: entry.service ?? fieldMeta?.service ?? undefined,
        });
        savedNames.push(entry.name);
      }
      return savedNames;
    }
    for (const [key, val] of Object.entries(payload.values ?? {})) {
      const fieldMeta = fields.find((f) => f.name === key);
      await saveVariable({
        name: key,
        kind: "secret",
        value: val,
        description: fieldMeta?.description ?? undefined,
        service: fieldMeta?.service ?? undefined,
      });
      savedNames.push(key);
    }
    return savedNames;
  }

  bb.agents.registerTool({
    name: "env_request",
    description:
      "Securely prompt the user for credentials (API key, FTP, SSH key, or login) via a masked in-app form. Use whenever access is missing from Env Catalog instead of asking in chat. Values are encrypted and never appear in the transcript.",
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
      kind: credentialKindSchema
        .optional()
        .describe("secret (default), ftp, ssh, or login — selects the form fields shown to the user"),
      service: z
        .string()
        .optional()
        .describe("Service label (OpenAI, OVH, Beget…)"),
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
        kind: parseKind(params.kind ?? "secret"),
        description: params.description ?? null,
        service: params.service ?? inferService(name, parseKind(params.kind ?? "secret")) ?? null,
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

      const savedNames = await persistRequestPayload(promptResult.payload, fields);

      return JSON.stringify({
        success: true,
        saved: savedNames,
        message: `Successfully received and encrypted ${savedNames.join(", ")} in Env Catalog. The values are preserved for future use and never disclosed in chat history.`,
      });
    },
  });

  // Dynamic Instructions for Agents
  bb.agents.contributeInstructions(() => {
    return "Env Catalog is active. It stores API keys, FTP/FTPS/SFTP accounts, SSH private keys, and site logins encrypted on the BB server for every enrolled machine. Before asking the user: env_list (optional query or kind=secret|ftp|ssh|login), then env_get with the exact name. env_get returns value and/or access fields (host, username, password, privateKey). Do not repeat secrets in chat. If access is missing, env_request with name and kind — never ask the user to paste credentials into the thread. Newly given credentials: env_set (kind + fields). File Gateway FTP is only for browsing site files in BB; use Env Catalog when a script, SSH session, or API call needs the credential.";
  });

  // CLI Command Registration
  const usage = [
    "Env Catalog CLI",
    "",
    "Usage:",
    "  bb env-catalog list [--query <text>] [--kind secret|ftp|ssh|login] [--json]",
    "  bb env-catalog get <NAME> [--raw]",
    "  bb env-catalog set <NAME> <VALUE> [--desc <text>] [--service <text>]",
    "  bb env-catalog set <NAME> --kind ftp --host <h> --user <u> --password <p> [--protocol ftp|ftps|sftp] [--port <n>] [--root <path>] [--fingerprint <hex>]",
    "  bb env-catalog set <NAME> --kind ssh --host <h> --user <u> --private-key <pem> [--port 22] [--passphrase <p>] [--fingerprint <hex>]",
    "  bb env-catalog set <NAME> --kind login --user <u> --password <p> [--url <url>] [--host <h>]",
    "  bb env-catalog request <NAME...> [--kind secret|ftp|ssh|login] [--purpose <text>] [--describe <NAME> <text>] [--service <text>]",
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
    kind: CredentialKind;
  } {
    const names: string[] = [];
    const descriptions = new Map<string, string>();
    const services = new Map<string, string>();
    let defaultService: string | null = null;
    let purpose: string | null = null;
    let threadId: string | null = null;
    let kind: CredentialKind = "secret";

    for (let i = 0; i < args.length; i++) {
      const token = args[i] ?? "";
      if (!token.startsWith("--")) {
        names.push(token.trim());
        continue;
      }
      if (token === "--kind") {
        i++;
        kind = parseKind(args[i]?.trim());
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

    return { names, purpose, descriptions, services, defaultService, threadId, kind };
  }

  bb.cli.register({
    name: "env-catalog",
    summary: "Manage encrypted API keys, FTP, SSH, and logins in Env Catalog",
    commands: [
      {
        name: "list",
        summary: "List stored environment variables",
        usage: "bb env-catalog list [--query <text>] [--kind secret|ftp|ssh|login] [--json]",
      },
      {
        name: "get",
        summary: "Get decrypted value of a secret",
        usage: "bb env-catalog get <NAME> [--raw]",
      },
      {
        name: "set",
        summary: "Store or update a secret",
        usage:
          "bb env-catalog set <NAME> <VALUE> | --kind ftp|ssh|login --host … --user …",
      },
      {
        name: "request",
        summary: "Securely request secrets from user via masked form in thread",
        usage:
          "bb env-catalog request <NAME...> [--kind secret|ftp|ssh|login] [--purpose <text>]",
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
          let kindFilter: CredentialKind | undefined;
          const kIdx = args.indexOf("--kind");
          if (kIdx !== -1 && args[kIdx + 1]) {
            kindFilter = parseKind(args[kIdx + 1]);
          }
          const items = await listSummaries(q, kindFilter);
          if (json) {
            return reply(items, "");
          }
          if (items.length === 0) {
            return reply([], "No credentials found.");
          }
          const table = items
            .map(
              (it) =>
                `${it.name.padEnd(28)} ${it.kind.padEnd(7)} ${it.maskedValue.padEnd(24)} ${
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
          const printable =
            item.kind === "secret" ? (item.value ?? "") : JSON.stringify(item.access, null, 2);
          if (raw) {
            return { exitCode: 0, stdout: printable };
          }
          return reply(item, `${item.name} (${item.kind})\n${printable}`);
        }

        case "set": {
          const name = args[0];
          if (!name) {
            return error("Name required: bb env-catalog set <NAME> …");
          }
          const take = (flag: string) => {
            const idx = args.indexOf(flag);
            return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
          };
          const kind = parseKind(take("--kind") ?? "secret");
          const description = take("--desc");
          const service = take("--service");
          if (kind === "secret") {
            const value = args[1]?.startsWith("--") ? undefined : args[1];
            if (value === undefined) {
              return error("Name and value required: bb env-catalog set <NAME> <VALUE>");
            }
            await saveVariable({ name, kind, value, description, service });
          } else {
            try {
              const access = accessFromFlat(kind, {
                protocol: take("--protocol"),
                host: take("--host"),
                port: take("--port") ? Number(take("--port")) : undefined,
                username: take("--user") ?? take("--username"),
                password: take("--password"),
                privateKey: take("--private-key"),
                passphrase: take("--passphrase"),
                fingerprint: take("--fingerprint"),
                root: take("--root"),
                url: take("--url"),
              });
              await saveVariable({ name, kind, access, description, service });
            } catch (err) {
              return error(err instanceof Error ? err.message : String(err));
            }
          }
          return reply({ success: true, name, kind }, `Saved '${name}' (${kind}) to Env Catalog.`);
        }

        case "request": {
          const { names, purpose, descriptions, services, defaultService, threadId, kind } =
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
            kind,
            description: descriptions.get(name) ?? null,
            service:
              services.get(name) ?? defaultService ?? inferService(name, kind) ?? null,
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

          const savedNames = await persistRequestPayload(promptResult.payload, fields);

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
          const count = await importFromMachineEnvironment();
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
