import type { AgentResult, PauseSource, PrState, RunState, SummaryOutcome } from "@ganger/core";
import type { McpActionOutcome } from "@ganger/db";
import type { InputWait } from "../home/model.js";
import type { RunControlView } from "../run-control-view.js";
import type { QueuedReason } from "../runs/model.js";

export type CiView = "success" | "failure" | "pending" | "none" | "unavailable" | "unknown";

export type TimelineEvent = { at: string } & (
  | { kind: "assigned" | "started" | "waiting-for-input" | "resumed" }
  | { kind: "paused" | "unpaused" }
  | { kind: "unreachable" | "disconnected" | "reconnected" }
  | { kind: "question" | "answer" | "permission"; body: string }
  | { kind: "denied"; body: string }
  | { kind: "cancel-requested" }
  | { kind: "ended"; agentResult: AgentResult }
  | { kind: "later-pr"; state: "merged" | "closed" }
  | {
      kind: "mcp";
      client: string;
      tool: string;
      outcome: McpActionOutcome;
      reason: string | null;
    }
);

export type PendingInput = InputWait | { kind: "unknown" };

export type LogTailView =
  | { kind: "none" }
  | { kind: "stored"; lines: string[] }
  | { kind: "pending" }
  | { kind: "done"; lines: string[]; at: string }
  | { kind: "failed"; error: string; at: string };

export type RunDetailStatus =
  | { state: "queued"; queuedReason: QueuedReason }
  | { state: "running" }
  | { state: "paused"; pausedSince: string | null; pauseSource: PauseSource }
  | {
      state: "waiting-for-input";
      input: PendingInput;
      inputSince: string | null;
    }
  | {
      state: "disconnected";
      unreachableSince: string | null;
    }
  | {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      summary: SummaryOutcome;
      worktreeNeedsManualRemoval: boolean;
      laterPrState: { state: "merged" | "closed"; at: string } | null;
    };

export type OtherRun = { id: string; assignedAt: string } & (
  | { state: Exclude<RunState, "ended"> }
  | {
      state: "ended";
      summary: SummaryOutcome;
    }
);

export interface RunDetail {
  id: string;
  now: string;
  ticketKey: string;
  ticketTitle: string | null;
  trackerProject: string;
  workspace: { id: string; name: string };
  branch: string | null;
  worktree: string | null;
  runner: { name: string; online: boolean } | null;
  agent: string;
  model: string | null;
  assignedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  waitMs: number;
  executionMs: number | null;
  status: RunDetailStatus;
  pullRequest: { displayId: string; url: string; ci: CiView } | null;
  report: string | null;
  startError: string | null;
  cancelPending: boolean;
  control: RunControlView | null;
  timeline: TimelineEvent[];
  log: LogTailView;
  otherRuns: OtherRun[];
}

export type RunDetailPage = { kind: "found"; run: RunDetail } | { kind: "not-found" };

export function canCancel(run: RunDetail): boolean {
  return run.status.state !== "ended";
}
