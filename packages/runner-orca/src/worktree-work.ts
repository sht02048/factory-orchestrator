import { AdapterError } from "@ganger/core";
import type { RunnerErrorDetail } from "@ganger/core";
import { z } from "zod";
import type { RemoteResult } from "./ssh.js";

const SSH_EXIT = 255;

export function uncommittedChangesArgv(path: string): string[] {
  return ["git", "-C", path, "status", "--porcelain", "--untracked-files=all"];
}

export function unpushedCommitsArgv(path: string): string[] {
  return ["git", "-C", path, "rev-list", "--count", "HEAD", "--not", "--remotes"];
}

const statusSchema = z.string().transform((text) => text.trim() !== "");
const countSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((text) => Number(text));

export function hasUncommittedChanges(result: RemoteResult): boolean {
  return parseGitOutput(result, statusSchema, "git status");
}

export function hasUnpushedCommits(result: RemoteResult): boolean {
  return parseGitOutput(result, countSchema, "git rev-list") > 0;
}

function parseGitOutput<T>(result: RemoteResult, schema: z.ZodType<T>, verb: string): T {
  if (result.timedOut) {
    throw new AdapterError<RunnerErrorDetail>({
      kind: "unreachable",
      detail: `timed out: ${verb}`,
    });
  }
  if (result.exitCode === SSH_EXIT) {
    throw new AdapterError<RunnerErrorDetail>({
      kind: "unreachable",
      detail: result.stderr.trim() || "ssh exited with 255",
    });
  }
  if (result.exitCode !== 0) {
    throw new AdapterError<RunnerErrorDetail>({
      kind: "runner-error",
      code: "git_failed",
      message: `${verb} exited with ${String(result.exitCode)}`,
    });
  }
  const parsed = schema.safeParse(result.stdout);
  if (!parsed.success) {
    throw new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: result.stdout });
  }
  return parsed.data;
}
