import type { LogFields, Logger } from "@ganger/log";
import type { RemoteResult } from "./ssh.js";

export const WRITE_VERBS: ReadonlySet<string> = new Set([
  "terminal create",
  "terminal send",
  "terminal close",
  "orchestration run-create",
  "orchestration run-use",
  "orchestration worker-start",
  "orchestration worker-stop",
  "orchestration worker-release",
  "orchestration send",
  "orchestration reply",
  "orchestration deny",
  "worktree rm",
]);

export interface RunnerCall {
  verb: string;
  write: boolean;
  orcaRunId?: string;
  worktreeName?: string;
}

export function describeRunnerCall(argv: ReadonlyArray<string>, orcaPath: string): RunnerCall {
  const [program, ...rest] = argv;
  if (program !== orcaPath) {
    const words = program === "env" ? rest.filter((word) => !word.includes("=")) : argv;
    return { verb: words.slice(0, 1).join(" ") || "unknown", write: false };
  }
  const words = rest.filter((word) => !word.startsWith("--")).slice(0, 2);
  const verb = rest[0] === "status" ? "status" : words.join(" ");
  const call: RunnerCall = { verb, write: WRITE_VERBS.has(verb) };
  if (verb === "orchestration worker-start") {
    const orcaRunId = valueAfter(rest, "--run");
    const worktreeName = valueAfter(rest, "--name");
    if (orcaRunId !== undefined) call.orcaRunId = orcaRunId;
    if (worktreeName !== undefined) call.worktreeName = worktreeName;
  }
  return call;
}

function valueAfter(words: ReadonlyArray<string>, flag: string): string | undefined {
  const index = words.indexOf(flag);
  return index === -1 ? undefined : words[index + 1];
}

export type RunnerCallOutcome =
  | { kind: "result"; result: RemoteResult }
  | { kind: "threw"; error: unknown };

export function logRunnerCall(
  logger: Logger,
  call: RunnerCall,
  ms: number,
  outcome: RunnerCallOutcome,
): void {
  const level = call.write ? "info" : "debug";
  if (!logger.enabled(level)) return;
  const fields: LogFields = {
    verb: call.verb,
    ms: Math.round(ms),
    ...(call.orcaRunId === undefined ? {} : { orcaRunId: call.orcaRunId }),
    ...(call.worktreeName === undefined ? {} : { worktreeName: call.worktreeName }),
    ...outcomeFields(outcome),
  };
  logger[level]("runner.call", fields);
}

function outcomeFields(outcome: RunnerCallOutcome): LogFields {
  if (outcome.kind === "threw") return { outcome: "unreachable", error: outcome.error };
  const { result } = outcome;
  const exit = result.exitCode;
  if (result.timedOut) return { exit, outcome: "timed-out" };
  if (exit === 255) return { exit, outcome: "unreachable", reason: stderrHead(result) };
  if (exit === 127) return { exit, outcome: "not-installed" };
  if (exit !== 0) return { exit, outcome: "failed", reason: stderrHead(result) };
  return { exit, outcome: okOutcome(result.stdout) };
}

function okOutcome(stdout: string): string {
  if (!stdout.trimStart().startsWith("{")) return "ok";
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) return "ok";
    if (parsed.ok !== false) return "ok";
    const error = "error" in parsed ? parsed.error : null;
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return typeof code === "string" ? `runner-error:${code}` : "runner-error";
  } catch {
    return "malformed-output";
  }
}

const STDERR_HEAD = 500;

function stderrHead(result: RemoteResult): string {
  return result.stderr.trim().slice(0, STDERR_HEAD);
}
