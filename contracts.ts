import { z } from "zod";
import { credentialKindSchema, MAX_SECRET_BYTES } from "./kinds.js";

export const secretNameSchema = z
  .string()
  .trim()
  .min(1, "Variable name cannot be empty")
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/u,
    "Variable name must start with a letter or underscore and contain only alphanumeric characters or underscores",
  );

export const envRequestFieldSchema = z.object({
  name: secretNameSchema,
  kind: credentialKindSchema.optional(),
  description: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
});

export type EnvRequestField = z.infer<typeof envRequestFieldSchema>;

export const envRequestPayloadSchema = z.object({
  purpose: z.string().nullable().optional(),
  fields: z.array(envRequestFieldSchema).min(1, "At least one variable must be requested"),
});

export type EnvRequestPayload = z.infer<typeof envRequestPayloadSchema>;

const secretValueSchema = z
  .string()
  .min(1, "Value cannot be empty")
  .max(MAX_SECRET_BYTES, `Value cannot exceed ${MAX_SECRET_BYTES} bytes`)
  .refine((val) => !val.includes("\0"), {
    message: "Secret value must not contain NUL bytes",
  });

const requestAccessSchema = z
  .object({
    protocol: z.enum(["ftp", "ftps", "sftp"]).optional(),
    host: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
    fingerprint: z.string().optional(),
    root: z.string().optional(),
    url: z.string().optional(),
  })
  .optional();

export const envRequestResponseSchema = z.object({
  values: z.record(secretNameSchema, secretValueSchema).optional(),
  entries: z
    .array(
      z.object({
        name: secretNameSchema,
        kind: credentialKindSchema.default("secret"),
        value: z.string().optional(),
        access: requestAccessSchema,
        description: z.string().nullable().optional(),
        service: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export type EnvRequestResponse = z.infer<typeof envRequestResponseSchema>;

export const ENV_REQUEST_RENDERER_ID = "env-catalog-request";

export const ENV_CATALOG_LOCK_CHANGED = "env-catalog:lock-changed";
export const LOCKED_MESSAGE = "Env Catalog is locked. Enter the PIN or password to open it.";

export const LOCK_KINDS = ["pin", "password"] as const;
export type LockKind = (typeof LOCK_KINDS)[number];

/** Limits of the page-lock settings. The upper limits keep guessing slow whatever the settings say. */
export const LOCK_LIMITS = {
  autoLockMinutes: { min: 1, max: 120, default: 5 },
  maxAttempts: { min: 3, max: 10, default: 5 },
  lockoutMinutes: { min: 1, max: 60, default: 1 },
  pinDigits: { min: 4, max: 12 },
  passwordLength: { min: 6, max: 128 },
} as const;

export type PasscodeProblem = "pinDigits" | "passwordLength";

export function passcodeProblem(kind: LockKind, passcode: string): PasscodeProblem | null {
  if (kind === "pin") {
    const { min, max } = LOCK_LIMITS.pinDigits;
    return new RegExp(`^[0-9]{${min},${max}}$`, "u").test(passcode) ? null : "pinDigits";
  }
  const { min, max } = LOCK_LIMITS.passwordLength;
  return passcode.length >= min && passcode.length <= max ? null : "passwordLength";
}
