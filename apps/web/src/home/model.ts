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

export type AttentionItem =
  | { kind: "run"; run: HomeRun }
  | { kind: "runner-issue"; runner: RunnerIssue };

export type ActivityEvent =
  | { kind: "started" | "question" | "permission" | "disconnected" }
  | { kind: "ended"; summary: SummaryOutcome }
  | { kind: "later-pr"; state: "merged" | "closed" };

export interface Activity {
  key: string;
  runId: string;
  ticketKey: string;
  workspace: WorkspaceSummary;
  event: ActivityEvent;
  at: string;
  agoMs: number;
}

export interface HomePage {
  workspace: WorkspaceChoice;
  attention: AttentionItem[];
  running: HomeRun[];
  queued: HomeRun[];
  mergedToday: number;
  activity: Activity[];
}

export function attentionKey(item: AttentionItem): string {
  return item.kind === "run" ? `run:${item.run.id}` : `runner:${item.runner.id}`;
}

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

export function partitionHome(input: {
  workspace: WorkspaceChoice;
  runs: ReadonlyArray<{ ticket: string; run: HomeRun }>;
  runnerIssues: ReadonlyArray<RunnerIssue>;
  mergedToday: number;
  activity: Activity[];
}): HomePage {
  const { workspace, activity } = input;
  if (workspace.kind === "none")
    return { workspace, attention: [], running: [], queued: [], mergedToday: 0, activity: [] };

  const latestByTicket = new Map<string, string>();
  for (const { ticket, run } of input.runs) latestByTicket.set(ticket, run.id);

  const attentionRuns = input.runs
    .flatMap(({ ticket, run }, index) =>
      needsAttention(run) && (run.state !== "ended" || latestByTicket.get(ticket) === run.id)
        ? [{ run, index }]
        : [],
    )
    .toSorted((a, b) => urgency(a.run) - urgency(b.run) || b.index - a.index)
    .map(({ run }): AttentionItem => ({ kind: "run", run }));

  const attention: AttentionItem[] = [
    ...input.runnerIssues.map((runner): AttentionItem => ({ kind: "runner-issue", runner })),
    ...attentionRuns,
  ];
  if (workspace.kind === "all")
    return { workspace, attention, running: [], queued: [], mergedToday: 0, activity };

  const runs = input.runs.map(({ run }) => run);
  return {
    workspace,
    attention,
    running: runs.filter((run) => run.state === "running"),
    queued: runs.filter((run) => run.state === "queued"),
    mergedToday: input.mergedToday,
    activity,
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
