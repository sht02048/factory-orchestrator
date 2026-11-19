import type { CompletionReport, RunnerErrorDetail, RunProgress } from "./adapters.js";
import type { PermissionRequestId, QuestionId } from "./ids.js";
import type { AgentResult, RunState } from "./run.js";

export const DISCONNECT_AFTER_MS = 5 * 60 * 1000;

export interface TimeoutDecision {
  agentResult: Extract<
    AgentResult,
    "timed-out" | "stopped-waiting-for-input" | "runner-disconnected" | "canceled"
  >;
  stopAgent: boolean;
  runnerUnreached: boolean;
}

export function countedRunMs(input: {
  startedAt: Date;
  now: Date;
  pausedMs: number;
  pausedSince: Date | null;
}): number {
  const currentPauseMs =
    input.pausedSince === null ? 0 : Math.max(0, input.now.getTime() - input.pausedSince.getTime());
  return input.now.getTime() - input.startedAt.getTime() - input.pausedMs - currentPauseMs;
}

export function decideTimeout(input: {
  state: RunState;
  startedAt: Date;
  now: Date;
  maxRunMs: number;
  pausedMs: number;
  cancelRequested: boolean;
}): TimeoutDecision | null {
  const counted = countedRunMs({ ...input, pausedSince: null });
  if (counted < input.maxRunMs) return null;
  switch (input.state) {
    case "running":
    case "waiting-for-input":
      return {
        agentResult: input.cancelRequested
          ? "canceled"
          : input.state === "running"
            ? "timed-out"
            : "stopped-waiting-for-input",
        stopAgent: true,
        runnerUnreached: false,
      };
    case "disconnected":
      return input.cancelRequested
        ? { agentResult: "canceled", stopAgent: false, runnerUnreached: true }
        : { agentResult: "runner-disconnected", stopAgent: false, runnerUnreached: false };
    case "queued":
    case "paused":
    case "ended":
      return null;
  }
}

export function decideConnection(input: {
  state: RunState;
  unreachableSince: Date | null;
  now: Date;
}): "disconnect" | "keep-watching" {
  if (
    input.state !== "running" &&
    input.state !== "waiting-for-input" &&
    input.state !== "paused"
  ) {
    return "keep-watching";
  }
  if (input.unreachableSince === null) return "keep-watching";
  const failingMs = input.now.getTime() - input.unreachableSince.getTime();
  return failingMs >= DISCONNECT_AFTER_MS ? "disconnect" : "keep-watching";
}

export type ProgressResolution =
  | { kind: "continue"; state: "running" }
  | {
      kind: "continue";
      state: "waiting-for-input";
      questions: ReadonlyArray<QuestionId>;
      permissionWaits: ReadonlyArray<PermissionRequestId>;
    }
  | {
      kind: "end";
      agentResult: Extract<
        AgentResult,
        "reported-success" | "reported-failure" | "ended-without-report" | "worktree-missing"
      >;
      report: CompletionReport | null;
    };

export function resolveRunProgress(
  progress: RunProgress,
  handled: {
    answered: ReadonlySet<QuestionId>;
    denied: ReadonlySet<PermissionRequestId>;
  },
): ProgressResolution {
  switch (progress.kind) {
    case "active": {
      const questions = progress.questions
        .map((q) => q.id)
        .filter((id) => !handled.answered.has(id));
      const permissionWaits = progress.permissionWaits
        .map((p) => p.id)
        .filter((id) => !handled.denied.has(id));
      if (questions.length === 0 && permissionWaits.length === 0) {
        return { kind: "continue", state: "running" };
      }
      return { kind: "continue", state: "waiting-for-input", questions, permissionWaits };
    }
    case "reported":
      return {
        kind: "end",
        agentResult:
          progress.report.outcome === "succeeded" ? "reported-success" : "reported-failure",
        report: progress.report,
      };
    case "ended-without-report":
      return { kind: "end", agentResult: "ended-without-report", report: null };
    case "worktree-gone":
      return { kind: "end", agentResult: "worktree-missing", report: null };
  }
}

export const MAX_START_RETRIES = 3;

export type StartFailureDecision =
  | { action: "wait-like-offline" | "find-then-retry" | "recreate-mailbox" }
  | { action: "retry" | "could-not-start"; failures: number };

export function decideStartFailure(
  error: RunnerErrorDetail,
  previousFailures: number,
): StartFailureDecision {
  switch (error.kind) {
    case "unreachable":
    case "not-ready":
    case "not-installed":
      return { action: "wait-like-offline" };
    case "start-outcome-unknown":
      return { action: "find-then-retry" };
    case "mailbox-missing":
      return { action: "recreate-mailbox" };
    case "malformed-output":
    case "runner-error": {
      const failures = previousFailures + 1;
      return { action: failures > MAX_START_RETRIES ? "could-not-start" : "retry", failures };
    }
  }
}

export interface RunDurations {
  leadTimeMs: number | null;
  waitMs: number | null;
  executionMs: number | null;
}

export function runDurations(input: {
  assignedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  now?: Date;
}): RunDurations {
  const { assignedAt, startedAt, endedAt, now } = input;
  const between = (from: Date, to: Date | null | undefined): number | null =>
    to === null || to === undefined ? null : to.getTime() - from.getTime();

  if (startedAt === null && endedAt !== null) {
    const waited = between(assignedAt, endedAt);
    return { leadTimeMs: waited, waitMs: waited, executionMs: 0 };
  }
  return {
    leadTimeMs: between(assignedAt, endedAt),
    waitMs: between(assignedAt, startedAt ?? now),
    executionMs: startedAt === null ? null : between(startedAt, endedAt ?? now),
  };
}
