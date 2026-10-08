import { z } from "zod";

export const CREDENTIAL_KINDS = ["secret", "ftp", "ssh", "login"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const credentialKindSchema = z.enum(CREDENTIAL_KINDS);

export const MAX_SECRET_BYTES = 64 * 1024;

const nonEmpty = z.string().trim().min(1);
const portSchema = z.coerce.number().int().min(1).max(65535);

export const ftpAccessSchema = z.object({
  protocol: z.enum(["ftp", "ftps", "sftp"]),
  host: nonEmpty.max(253),
  port: portSchema,
  username: nonEmpty.max(200),
  password: z.string().min(1).max(4096),
  root: z.string().max(4096).optional(),
  fingerprint: z.string().max(128).optional(),
});

export const sshAccessSchema = z.object({
  host: nonEmpty.max(253),
  port: portSchema,
  username: nonEmpty.max(200),
  privateKey: z.string().min(1).max(MAX_SECRET_BYTES),
  passphrase: z.string().max(4096).optional(),
  fingerprint: z.string().max(128).optional(),
});

export const loginAccessSchema = z.object({
  url: z.string().max(2048).optional(),
  host: z.string().max(253).optional(),
  username: nonEmpty.max(200),
  password: z.string().min(1).max(4096),
});

export type FtpAccess = z.infer<typeof ftpAccessSchema>;
export type SshAccess = z.infer<typeof sshAccessSchema>;
export type LoginAccess = z.infer<typeof loginAccessSchema>;
export type AccessPayload = FtpAccess | SshAccess | LoginAccess;

const packedSchema = z.object({
  v: z.literal(1),
  kind: credentialKindSchema,
  access: z.unknown(),
});

export function parseKind(raw: string | null | undefined): CredentialKind {
  if (raw && CREDENTIAL_KINDS.includes(raw as CredentialKind)) {
    return raw as CredentialKind;
  }
  return "secret";
}

export function packStoredValue(
  kind: CredentialKind,
  value: string | undefined,
  access: unknown,
): string {
  if (kind === "secret") {
    const text = value ?? "";
    if (!text) {
      throw new Error("Secret value cannot be empty");
    }
    if (Buffer.byteLength(text, "utf8") > MAX_SECRET_BYTES) {
      throw new Error(`Secret value cannot exceed ${MAX_SECRET_BYTES} bytes`);
    }
    return text;
  }

  const parsed = parseAccess(kind, access);
  const packed = JSON.stringify({ v: 1, kind, access: parsed });
  if (Buffer.byteLength(packed, "utf8") > MAX_SECRET_BYTES) {
    throw new Error(`Credential cannot exceed ${MAX_SECRET_BYTES} bytes`);
  }
  return packed;
}

export function parseAccess(kind: Exclude<CredentialKind, "secret">, access: unknown): AccessPayload {
  if (kind === "ftp") {
    const parsed = ftpAccessSchema.safeParse(access);
    if (!parsed.success) {
      throw new Error(`Invalid FTP fields: ${parsed.error.issues[0]?.message ?? "check host, user, password"}`);
    }
    return parsed.data;
  }
  if (kind === "ssh") {
    const parsed = sshAccessSchema.safeParse(access);
    if (!parsed.success) {
      throw new Error(`Invalid SSH fields: ${parsed.error.issues[0]?.message ?? "check host, user, private key"}`);
    }
    return parsed.data;
  }
  const parsed = loginAccessSchema.safeParse(access);
  if (!parsed.success) {
    throw new Error(`Invalid login fields: ${parsed.error.issues[0]?.message ?? "check username and password"}`);
  }
  if (!parsed.data.url && !parsed.data.host) {
    throw new Error("Login needs a URL or host");
  }
  return parsed.data;
}

export function unpackStoredValue(kind: CredentialKind, decrypted: string): {
  kind: CredentialKind;
  value: string | null;
  access: AccessPayload | null;
} {
  if (kind !== "secret") {
    const packed = packedSchema.safeParse(safeJson(decrypted));
    if (packed.success && packed.data.kind === kind) {
      return {
        kind,
        value: null,
        access: parseAccess(kind, packed.data.access),
      };
    }
    // Column says structured, but payload is legacy plaintext — treat as secret value.
    return { kind: "secret", value: decrypted, access: null };
  }

  const packed = packedSchema.safeParse(safeJson(decrypted));
  if (packed.success && packed.data.kind !== "secret") {
    try {
      return {
        kind: packed.data.kind,
        value: null,
        access: parseAccess(packed.data.kind, packed.data.access),
      };
    } catch {
      return { kind: "secret", value: decrypted, access: null };
    }
  }

  return { kind: "secret", value: decrypted, access: null };
}

function safeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function maskAccess(kind: CredentialKind, decrypted: string): string {
  const unpacked = unpackStoredValue(kind, decrypted);
  if (unpacked.kind === "secret") {
    return maskSecret(unpacked.value ?? "");
  }
  if (unpacked.kind === "ftp" && unpacked.access && "protocol" in unpacked.access) {
    const a = unpacked.access;
    return `${a.protocol}://${a.username}@${a.host}:${a.port}`;
  }
  if (unpacked.kind === "ssh" && unpacked.access && "privateKey" in unpacked.access) {
    const a = unpacked.access;
    return `${a.username}@${a.host}:${a.port}`;
  }
  if (unpacked.kind === "login" && unpacked.access && "password" in unpacked.access && !("protocol" in unpacked.access) && !("privateKey" in unpacked.access)) {
    const a = unpacked.access;
    const target = a.url || a.host || "";
    return `${a.username}@${target}`;
  }
  return "••••••••";
}

export function maskSecret(val: string): string {
  if (!val || val.length === 0) return "";
  if (val.length <= 8) return "••••••••";
  return `${val.slice(0, 4)}••••••••${val.slice(-4)}`;
}

export function revealText(kind: CredentialKind, decrypted: string): string {
  const unpacked = unpackStoredValue(kind, decrypted);
  if (unpacked.kind === "secret") {
    return unpacked.value ?? "";
  }
  return JSON.stringify(unpacked.access, null, 2);
}

export function copyText(kind: CredentialKind, decrypted: string): string {
  const unpacked = unpackStoredValue(kind, decrypted);
  if (unpacked.kind === "secret") {
    return unpacked.value ?? "";
  }
  if (unpacked.kind === "ssh" && unpacked.access && "privateKey" in unpacked.access) {
    return unpacked.access.privateKey;
  }
  if (unpacked.kind === "ftp" && unpacked.access && "password" in unpacked.access) {
    return unpacked.access.password;
  }
  if (unpacked.kind === "login" && unpacked.access && "password" in unpacked.access) {
    return unpacked.access.password;
  }
  return revealText(kind, decrypted);
}

export function publicAccessView(access: AccessPayload | null): Record<string, unknown> | null {
  if (!access) return null;
  if ("privateKey" in access) {
    const { privateKey, passphrase, ...rest } = access;
    return {
      ...rest,
      hasPrivateKey: Boolean(privateKey),
      hasPassphrase: Boolean(passphrase),
    };
  }
  if ("password" in access) {
    const { password, ...rest } = access;
    return {
      ...rest,
      hasPassword: Boolean(password),
    };
  }
  return access;
}

export function defaultPort(kind: CredentialKind, protocol?: string): number {
  if (kind === "ssh") return 22;
  if (protocol === "sftp") return 22;
  return 21;
}

export function accessFromFlat(kind: Exclude<CredentialKind, "secret">, flat: {
  protocol?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  fingerprint?: string;
  root?: string;
  url?: string;
}): AccessPayload {
  if (kind === "ftp") {
    return parseAccess("ftp", {
      protocol: flat.protocol ?? "ftps",
      host: flat.host,
      port: flat.port ?? defaultPort("ftp", flat.protocol),
      username: flat.username,
      password: flat.password,
      root: flat.root || undefined,
      fingerprint: flat.fingerprint || undefined,
    });
  }
  if (kind === "ssh") {
    return parseAccess("ssh", {
      host: flat.host,
      port: flat.port ?? 22,
      username: flat.username,
      privateKey: flat.privateKey,
      passphrase: flat.passphrase || undefined,
      fingerprint: flat.fingerprint || undefined,
    });
  }
  return parseAccess("login", {
    url: flat.url || undefined,
    host: flat.host || undefined,
    username: flat.username,
    password: flat.password,
  });
}
