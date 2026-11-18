import { isAbsolute } from "node:path";
import { z } from "zod";

export interface BootConfig {
  host: string;
  port: number;
  databasePath: string;
  encryptionKey: Uint8Array;
}

export const BOOT_ENV = {
  host: "WEB_HOST",
  port: "WEB_PORT",
  databasePath: "DATABASE_PATH",
  encryptionKey: "ENCRYPTION_KEY",
} as const;

export const ENCRYPTION_KEY_BYTES = 32;

export interface BootConfigIssue {
  variable: string;
  message: string;
}

export class BootConfigError extends Error {
  readonly issues: ReadonlyArray<BootConfigIssue>;

  constructor(issues: ReadonlyArray<BootConfigIssue>) {
    super(
      `boot configuration is invalid: ${issues.map((i) => `${i.variable} ${i.message}`).join("; ")}`,
    );
    this.name = "BootConfigError";
    this.issues = issues;
  }
}

const required = () =>
  z.string({ error: "is required" }).trim().min(1, { error: "is required", abort: true });

const envSchema = z.object({
  [BOOT_ENV.host]: z
    .string()
    .trim()
    .min(1, { error: "must not be empty" })
    .optional()
    .default("127.0.0.1"),
  [BOOT_ENV.port]: z
    .string()
    .trim()
    .regex(/^\d+$/, { error: "must be an integer between 1 and 65535" })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1, { error: "must be an integer between 1 and 65535" })
        .max(65535, { error: "must be an integer between 1 and 65535" }),
    )
    .optional()
    .default(3000),
  [BOOT_ENV.databasePath]: required().refine(isAbsolute, { error: "must be an absolute path" }),
  [BOOT_ENV.encryptionKey]: required()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, {
      error: `must be base64 (generate one with: openssl rand -base64 ${ENCRYPTION_KEY_BYTES})`,
    })
    .transform((value) => new Uint8Array(Buffer.from(value, "base64")))
    .refine((key) => key.length === ENCRYPTION_KEY_BYTES, {
      error: `must decode to ${ENCRYPTION_KEY_BYTES} bytes (generate one with: openssl rand -base64 ${ENCRYPTION_KEY_BYTES})`,
    }),
});

export function parseBootConfig(env: Readonly<Record<string, string | undefined>>): BootConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new BootConfigError(
      result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "environment"),
        message: issue.message,
      })),
    );
  }
  const data = result.data;
  return {
    host: data[BOOT_ENV.host],
    port: data[BOOT_ENV.port],
    databasePath: data[BOOT_ENV.databasePath],
    encryptionKey: data[BOOT_ENV.encryptionKey],
  };
}
