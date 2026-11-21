import type {
  AgentId,
  AgentRef,
  RunId,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerProjectId,
  WorktreeRef,
} from "./ids.js";

export const RUN_STATES = [
  "queued",
  "running",
  "waiting-for-input",
  "paused",
  "disconnected",
  "ended",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const ACTIVE_RUN_STATES: ReadonlySet<RunState> = new Set([
  "queued",
  "running",
  "waiting-for-input",
  "paused",
  "disconnected",
]);

export const CAPACITY_OCCUPYING_STATES: ReadonlySet<RunState> = new Set([
  "running",
  "waiting-for-input",
  "paused",
  "disconnected",
]);

export const PAUSE_SOURCES = ["operator", "runner", "unreported"] as const;
export type PauseSource = (typeof PAUSE_SOURCES)[number];

export const AGENT_RESULTS = [
  "reported-success",
  "reported-failure",
  "ended-without-report",
  "timed-out",
  "stopped-waiting-for-input",
  "runner-disconnected",
  "worktree-missing",
  "canceled",
  "could-not-start",
] as const;
export type AgentResult = (typeof AGENT_RESULTS)[number];

export const NOT_STARTED_AGENT_RESULTS = ["canceled", "could-not-start"] as const;
export type NotStartedAgentResult = (typeof NOT_STARTED_AGENT_RESULTS)[number];

export const PR_STATES = ["none", "open", "merged", "closed", "unknown"] as const;
export type PrState = (typeof PR_STATES)[number];
export type ReadPrState = Exclude<PrState, "unknown">;

export const PR_READ_ERRORS = ["no-access", "other"] as const;
export type PrReadError = (typeof PR_READ_ERRORS)[number];

export const SUMMARY_OUTCOMES = ["succeeded", "failed", "canceled"] as const;
export type SummaryOutcome = (typeof SUMMARY_OUTCOMES)[number];

export const WORKTREE_DISPOSITIONS = [
  "remove-now",
  "keep-until-pr-settles",
  "operator-decides",
  "nothing-to-remove",
] as const;
export type WorktreeDisposition = (typeof WORKTREE_DISPOSITIONS)[number];

export const WORKTREE_KEPT_REASONS = [
  "uncommitted-changes",
  "unpushed-commits",
  "check-failed",
] as const;
export type WorktreeKeptReason = (typeof WORKTREE_KEPT_REASONS)[number];

export interface TicketRef {
  connection: TrackerConnectionId;
  key: TicketKey;
}

export function sameTicket(a: TicketRef, b: TicketRef): boolean {
  return a.connection === b.connection && a.key === b.key;
}

interface RunBase {
  id: RunId;
  ticket: TicketRef;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  model: string | null;
  worktreeName: string;
  assignedAt: Date;
}

interface StartedRunFields {
  runnerId: RunnerId;
  worktree: WorktreeRef;
  branch: string;
  agentRef: AgentRef;
  startedAt: Date;
}

export interface RunAxes {
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
}

export type StartedEndedRun = RunBase &
  StartedRunFields &
  RunAxes & {
    state: "ended";
    endedAt: Date;
  };

export type NotStartedEndedRun = RunBase & {
  state: "ended";
  runnerId: RunnerId | null;
  worktree: null;
  branch: null;
  agentRef: null;
  startedAt: null;
  endedAt: Date;
  agentResult: NotStartedAgentResult;
  prState: "none";
  runnerUnreached: false;
};

export type EndedRun = StartedEndedRun | NotStartedEndedRun;

export type Run =
  | (RunBase & { state: "queued"; runnerId: RunnerId | null })
  | (RunBase &
      StartedRunFields & {
        state: "running" | "waiting-for-input" | "paused" | "disconnected";
      })
  | EndedRun;
