import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { QueuedReason } from "../runs/model";
import type { RunnerIssueCause, WorkspaceChoice, WorkspaceSummary } from "../shell/model";

export type InputWait =
  | {
      kind: "question";
      questionId: string;
      body: string;
      choices: string[];
      answered: boolean;
    }
  | {
      kind: "permission";
      promptId: string;
      detail: string;
      denied: boolean;
    };

interface HomeRunBase {
  id: string;
  ticketKey: string;
  trackerProject: string;
  workspace: WorkspaceSummary;
  runner: { name: string; online: boolean } | null;
  agent: string;
  waitMs: number;
  executionMs: number | null;
  pullRequest: { displayId: string; url: string } | null;
  cancelling: boolean;
}

export type HomeRun =
  | (HomeRunBase & { state: "queued"; queuedReason: QueuedReason })
  | (HomeRunBase & { state: "running" })
  | (HomeRunBase & {
      state: "waiting-for-input";
      input: InputWait | null;
      waitingMs: number | null;
    })
  | (HomeRunBase & {
      state: "disconnected";
      unreachableMs: number | null;
    })
  | (HomeRunBase & {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      summary: SummaryOutcome;
      prSettledLater: boolean;
    });

export interface RunnerIssue {
  id: string;
  name: string;
  cause: RunnerIssueCause;
}

export interface AttentionItem {
  kind: "run";
  run: HomeRun;
}

export interface RunnersSummary {
  issues: RunnerIssue[];
  online: number;
}

export interface DoneRun {
  id: string;
  ticketKey: string;
  workspace: WorkspaceSummary;
  summary: SummaryOutcome;
  endedAt: string;
  endedAgoMs: number;
}

export interface DoneToday {
  recent: DoneRun[];
  total: number;
}

export interface HomePage {
  workspace: WorkspaceChoice;
  attention: AttentionItem[];
  running: HomeRun[];
  queued: HomeRun[];
  runners: RunnersSummary;
  doneToday: DoneToday;
}

export const DONE_TODAY_LIMIT = 5;

export function needsAttention(run: HomeRun): boolean {
  switch (run.state) {
    case "waiting-for-input":
    case "disconnected":
      return true;
    case "ended":
      return (run.summary === "human-check" && !run.prSettledLater) || run.summary === "failed";
    case "queued":
    case "running":
      return false;
  }
}

const noRunners: RunnersSummary = { issues: [], online: 0 };
const nothingDone: DoneToday = { recent: [], total: 0 };

export function partitionHome(input: {
  workspace: WorkspaceChoice;
  runs: ReadonlyArray<{ ticket: string; run: HomeRun }>;
  runners: RunnersSummary;
  doneToday: ReadonlyArray<DoneRun>;
}): HomePage {
  const { workspace } = input;
  if (workspace.kind === "none")
    return {
      workspace,
      attention: [],
      running: [],
      queued: [],
      runners: noRunners,
      doneToday: nothingDone,
    };

  const latestByTicket = new Map<string, string>();
  for (const { ticket, run } of input.runs) latestByTicket.set(ticket, run.id);

  const attention = input.runs
    .flatMap(({ ticket, run }, index) =>
      needsAttention(run) && (run.state !== "ended" || latestByTicket.get(ticket) === run.id)
        ? [{ run, index }]
        : [],
    )
    .toSorted((a, b) => urgency(a.run) - urgency(b.run) || b.index - a.index)
    .map(({ run }): AttentionItem => ({ kind: "run", run }));

  if (workspace.kind === "all")
    return {
      workspace,
      attention,
      running: [],
      queued: [],
      runners: input.runners,
      doneToday: nothingDone,
    };

  const runs = input.runs.map(({ run }) => run);
  const done = input.doneToday.toSorted((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  return {
    workspace,
    attention,
    running: runs.filter((run) => run.state === "running"),
    queued: runs.filter((run) => run.state === "queued"),
    runners: input.runners,
    doneToday: {
      recent: done.slice(0, DONE_TODAY_LIMIT),
      total: done.length,
    },
  };
}

function urgency(run: HomeRun): number {
  switch (run.state) {
    case "waiting-for-input":
      return 0;
    case "disconnected":
      return 1;
    case "ended":
    case "queued":
    case "running":
      return 2;
  }
}
