import { z } from "zod";

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
  .max(16 * 1024, "Value cannot exceed 16 KiB")
  .refine((val) => !val.includes("\0"), {
    message: "Secret value must not contain NUL bytes",
  });

export const envRequestResponseSchema = z.object({
  values: z.record(secretNameSchema, secretValueSchema),
});

export type EnvRequestResponse = z.infer<typeof envRequestResponseSchema>;

export const ENV_REQUEST_RENDERER_ID = "env-catalog-request";
