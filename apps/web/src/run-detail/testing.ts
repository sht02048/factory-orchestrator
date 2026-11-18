import {
  toAgentId,
  toAgentRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { AgentResult, PrState, RunId, SummaryOutcome } from "@ganger/core";
import { assignRun, changeRunState } from "@ganger/db";
import type { Database, RunStateChange } from "@ganger/db";
import { connection, minutes } from "../testing/seed";

export function startedOn(key: string): Extract<RunStateChange, { to: "running" }> {
  return {
    to: "running",
    started: {
      worktree: toWorktreeRef(`wt-${key}`),
      branch: `acme/${key.toLowerCase()}`,
      agentRef: toAgentRef(`agent-${key}`),
    },
  };
}

export function assign(db: Database, key: string, at: number, model: string | null = null): RunId {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    model,
    now: minutes(at),
  });
  if (!result.ok) throw new Error(`assign ${key}: ${result.reason}`);
  return result.run.id;
}

export function walk(
  db: Database,
  id: RunId,
  at: number,
  steps: ReadonlyArray<RunStateChange>,
): void {
  steps.forEach((step, i) => {
    const r = changeRunState(db, id, step, minutes(at + 1 + i));
    if (!r.ok) throw new Error(JSON.stringify(r));
  });
}

export interface ExtraEndedCase {
  key: string;
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
  started: boolean;
  summary: SummaryOutcome;
}

export const extraEndedCases: ReadonlyArray<ExtraEndedCase> = [
  {
    key: "ACME-20",
    agentResult: "ended-without-report",
    prState: "open",
    runnerUnreached: false,
    started: true,
    summary: "failed",
  },
  {
    key: "ACME-21",
    agentResult: "canceled",
    prState: "open",
    runnerUnreached: false,
    started: true,
    summary: "canceled",
  },
  {
    key: "ACME-22",
    agentResult: "canceled",
    prState: "none",
    runnerUnreached: true,
    started: true,
    summary: "canceled",
  },
  {
    key: "ACME-23",
    agentResult: "canceled",
    prState: "none",
    runnerUnreached: false,
    started: false,
    summary: "canceled",
  },
  {
    key: "ACME-24",
    agentResult: "could-not-start",
    prState: "none",
    runnerUnreached: false,
    started: false,
    summary: "failed",
  },
];

export function addExtraEnded(db: Database): Map<string, RunId> {
  const ids = new Map<string, RunId>();
  extraEndedCases.forEach((c, i) => {
    const at = 200 + i * 10;
    const id = assign(db, c.key, at);
    const end: RunStateChange = {
      to: "ended",
      agentResult: c.agentResult,
      prState: c.prState,
      runnerUnreached: c.runnerUnreached,
    };
    walk(db, id, at, c.started ? [startedOn(c.key), end] : [end]);
    ids.set(c.key, id);
  });
  return ids;
}
