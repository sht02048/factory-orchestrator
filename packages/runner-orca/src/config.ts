import { z } from "zod";

export const DEFAULT_ORCA_PATH = "/Applications/Orca.app/Contents/Resources/bin/orca";

const absolutePath = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/"), { error: "must be an absolute path" });

export const gangerSshAccessSchema = z.object({
  kind: z.literal("ganger"),
  identityFile: absolutePath,
  knownHostsFile: absolutePath,
});

export type GangerSshAccess = z.infer<typeof gangerSshAccessSchema>;

export const orcaRunnerConfigSchema = z.object({
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.startsWith("-"), { error: "must not start with '-'" }),
  orcaPath: z.string().trim().min(1).default(DEFAULT_ORCA_PATH),
  model: z.string().trim().min(1).optional(),
  connectTimeoutSeconds: z.number().int().positive().default(10),
  commandTimeoutMs: z.number().int().positive().default(60_000),
  startTimeoutMs: z.number().int().positive().default(180_000),
  access: gangerSshAccessSchema.optional(),
});

export type OrcaRunnerConfig = z.infer<typeof orcaRunnerConfigSchema>;

export class OrcaRunnerConfigError extends Error {
  constructor(issues: ReadonlyArray<string>) {
    super(`orca runner configuration is invalid: ${issues.join("; ")}`);
    this.name = "OrcaRunnerConfigError";
  }
}

export function parseOrcaRunnerConfig(config: unknown): OrcaRunnerConfig {
  const parsed = orcaRunnerConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new OrcaRunnerConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`),
    );
  }
  return parsed.data;
}
