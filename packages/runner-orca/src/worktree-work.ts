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

export function worktreeListArgv(repoPath: string): string[] {
  return ["git", "-C", repoPath, "worktree", "list", "--porcelain"];
}

export function worktreePruneArgv(repoPath: string): string[] {
  return ["git", "-C", repoPath, "worktree", "prune"];
}

export function localBranchArgv(repoPath: string, branch: string): string[] {
  return ["git", "-C", repoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`];
}

export function remoteBranchArgv(repoPath: string, remote: string, branch: string): string[] {
  return ["git", "-C", repoPath, "ls-remote", "--exit-code", remote, `refs/heads/${branch}`];
}

export function fetchBranchArgv(repoPath: string, remote: string, branch: string): string[] {
  return [
    "git",
    "-C",
    repoPath,
    "fetch",
    remote,
    `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
  ];
}

export function addWorktreeArgv(repoPath: string, path: string, branch: string): string[] {
  return ["git", "-C", repoPath, "worktree", "add", path, branch];
}

export function addTrackingWorktreeArgv(
  repoPath: string,
  path: string,
  branch: string,
  remote: string,
): string[] {
  return [
    "git",
    "-C",
    repoPath,
    "worktree",
    "add",
    "--track",
    "-b",
    branch,
    path,
    `${remote}/${branch}`,
  ];
}

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  prunable: boolean;
}

const worktreeEntrySchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1).nullable(),
  prunable: z.boolean(),
});

export function parseWorktreeList(result: RemoteResult): GitWorktreeEntry[] {
  const stdout = parseGitOutput(result, z.string(), "git worktree list");
  const entries = stdout
    .split(/\n\n+/)
    .map((block) => block.split("\n").filter((line) => line !== ""))
    .filter((lines) => lines.length > 0)
    .map((lines) => ({
      path: valueOfLine(lines, "worktree ") ?? "",
      branch: valueOfLine(lines, "branch refs/heads/"),
      prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
    }));
  const parsed = z.array(worktreeEntrySchema).safeParse(entries);
  if (!parsed.success) {
    throw new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: stdout });
  }
  return parsed.data;
}

function valueOfLine(lines: ReadonlyArray<string>, prefix: string): string | null {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length);
}

export function refFound(result: RemoteResult, verb: string, absentExitCode: number): boolean {
  if (result.exitCode === absentExitCode && !result.timedOut) return false;
  parseGitOutput(result, z.string(), verb);
  return true;
}

export function gitSucceeded(result: RemoteResult, verb: string): void {
  parseGitOutput(result, z.string(), verb);
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
