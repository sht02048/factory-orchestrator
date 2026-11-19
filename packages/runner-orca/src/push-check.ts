import type { PrerequisiteFailure, PrerequisiteFailureKind } from "@ganger/core";
import { z } from "zod";
import type { RemoteResult } from "./ssh.js";

export const PUSH_CHECK_REF = "HEAD:refs/heads/ganger/push-check";
export const PUSH_CHECK_TIMEOUT_MS = 20_000;
export const PUSH_RETRY_DELAY_MS = 1_000;
export const PUSH_CHECK_CONCURRENCY = 4;
const REASON_LIMIT = 200;
const SSH_EXIT = 255;

export function remoteConfigArgv(path: string): string[] {
  return ["git", "-C", path, "config", "--get-regexp", "^remote\\."];
}

export function pushArgv(path: string, remote: string): string[] {
  return [
    "env",
    "GIT_TERMINAL_PROMPT=0",
    "GIT_SSH_COMMAND=ssh -o BatchMode=yes",
    "git",
    "-C",
    path,
    "push",
    "--dry-run",
    "--porcelain",
    "--no-verify",
    remote,
    PUSH_CHECK_REF,
  ];
}

const remoteConfigSchema = z.string().transform((text) => {
  const remotes = new Set<string>();
  let pushDefault: string | null = null;
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const key = line.slice(0, space);
    const value = line.slice(space + 1).trim();
    if (key.toLowerCase() === "remote.pushdefault") {
      if (value !== "") pushDefault = value;
      continue;
    }
    const url = /^remote\.(.+)\.url$/i.exec(key);
    if (url?.[1] !== undefined) remotes.add(url[1]);
  }
  return { remotes, pushDefault };
});

export function choosePushRemote(configOutput: string, projectRemote: string): string {
  const parsed = remoteConfigSchema.safeParse(configOutput);
  if (!parsed.success) return projectRemote;
  const { remotes, pushDefault } = parsed.data;
  if (pushDefault !== null) return pushDefault;
  if (remotes.has("origin")) return "origin";
  return projectRemote;
}

export type PushCheckOutcome =
  | { satisfied: true }
  | { satisfied: false | null; failure: PrerequisiteFailure };

const AUTH_PATTERNS = [
  /permission to .* denied/i,
  /permission denied/i,
  /authentication failed/i,
  /could not read (username|password)/i,
  /terminal prompts disabled/i,
  /invalid username or password/i,
  /repository not found/i,
  /returned error: 40[13]/i,
];

const NETWORK_PATTERNS = [
  /could not resolve host/i,
  /could not resolve hostname/i,
  /connection (timed out|refused|reset)/i,
  /network is unreachable/i,
  /operation timed out/i,
  /failed to connect/i,
  /ssh: connect to host/i,
  /unable to access/i,
];

const NOISE = [/^warning: /i, /^hint: /i, /^to /i];

function matchesAny(line: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(line));
}

function reasonLine(stderr: string): { line: string | null; kind: PrerequisiteFailureKind } {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const auth = lines.find((line) => matchesAny(line, AUTH_PATTERNS));
  if (auth !== undefined) return { line: auth, kind: "auth" };
  const network = lines.find((line) => matchesAny(line, NETWORK_PATTERNS));
  if (network !== undefined) return { line: network, kind: "network" };
  const other = lines.find((line) => !matchesAny(line, NOISE)) ?? lines[0] ?? null;
  return { line: other, kind: "other" };
}

export function redactReason(line: string, paths: ReadonlyArray<string>): string {
  let text = line;
  for (const path of paths) {
    if (path !== "") text = text.replaceAll(path, "<repo>");
  }
  const redacted = text
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, "<token>")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1<redacted>@")
    .replace(/(^|[\s'"(=])(\/(?:Users|home|root|private|var|tmp|opt)\/[^\s'")]*)/g, "$1<path>")
    .replace(/(^|[\s'"(=])(~\/[^\s'")]*)/g, "$1<path>")
    .replace(/^remote:\s*/i, "");
  return redacted.length > REASON_LIMIT ? `${redacted.slice(0, REASON_LIMIT - 1)}…` : redacted;
}

export function classifyPush(result: RemoteResult, paths: ReadonlyArray<string>): PushCheckOutcome {
  if (result.timedOut) {
    return { satisfied: null, failure: { kind: "timeout", reason: null } };
  }
  if (result.exitCode === 0) return { satisfied: true };
  const { line, kind } = reasonLine(result.stderr);
  const reason = line === null ? null : redactReason(line, paths);
  if (result.exitCode === SSH_EXIT || result.exitCode === null) {
    return { satisfied: null, failure: { kind: "network", reason } };
  }
  return { satisfied: false, failure: { kind, reason } };
}

export function unknownPush(error: unknown, paths: ReadonlyArray<string>): PushCheckOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return { satisfied: null, failure: { kind: "network", reason: redactReason(message, paths) } };
}

export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
