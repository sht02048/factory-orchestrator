import { isAbsolute } from "node:path";
import type { RunnerId } from "@ganger/core";
import { DEFAULT_ORCA_PATH, quoteArg, sshExec } from "@ganger/runner-orca";
import type { RemoteExec } from "@ganger/runner-orca";
import { z } from "zod";
import { saveRunnerSetting } from "../settings/actions.js";
import type { runnerInput } from "../settings/actions.js";
import type { SettingsContext } from "../settings/load.js";

const SSH_FAILED_EXIT = 255;
const FIND_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_SECONDS = 10;

const orcaPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(isAbsolute)
  .refine((value) => !/["\n\r]/u.test(value));

export type FindOrcaResult =
  | { ok: true; orcaPath: string }
  | { ok: false; reason: "orca-not-found" | "ssh-failed" };

export function findOrcaCommand(defaultOrcaPath = DEFAULT_ORCA_PATH): string {
  const known = quoteArg(defaultOrcaPath);
  return `if [ -x ${known} ]; then printf '%s\\n' ${known}; else "\${SHELL:-/bin/sh}" -lc 'command -v orca'; fi`;
}

export async function findOrcaOverSsh(exec: RemoteExec): Promise<FindOrcaResult> {
  let result;
  try {
    result = await exec.run(findOrcaCommand(), { timeoutMs: FIND_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: "ssh-failed" };
  }
  if (result.timedOut || result.exitCode === SSH_FAILED_EXIT || result.exitCode === null) {
    return { ok: false, reason: "ssh-failed" };
  }
  if (result.exitCode !== 0) return { ok: false, reason: "orca-not-found" };
  const parsed = orcaPathSchema.safeParse(result.stdout.trim().split("\n").at(-1));
  return parsed.success
    ? { ok: true, orcaPath: parsed.data }
    : { ok: false, reason: "orca-not-found" };
}

export type SaveRunnerResult =
  | { ok: true; runnerId: RunnerId }
  | { ok: false; reason: "not-found" | "orca-not-found" | "ssh-failed" };

export async function saveRunnerFindingOrca(
  context: SettingsContext,
  input: z.infer<typeof runnerInput>,
  now: Date,
  execFor: (sshTarget: string) => RemoteExec = (sshTarget) =>
    sshExec({ sshTarget, connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS }),
): Promise<SaveRunnerResult> {
  if (input.orcaPath !== "") return saveRunnerSetting(context, input, now);
  const found = await findOrcaOverSsh(execFor(input.sshTarget));
  if (!found.ok) return found;
  return saveRunnerSetting(context, { ...input, orcaPath: found.orcaPath }, now);
}
