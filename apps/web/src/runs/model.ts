import type { AgentResult, PrState, SummaryOutcome } from "@ganger/core";
import type { WorkspaceChoice } from "../shell/model";
import type { StatsPeriodDays } from "../stats/model";

export type QueuedReason =
  | {
      kind: "starting" | "behind" | "runner-offline" | "project-missing" | "assignment-blocked";
    }
  | { kind: "no-capacity"; runner: string };

interface RunViewBase {
  id: string;
  ticketKey: string;
  ticketTitle: string | null;
  trackerProject: string;
  branch: string | null;
  runner: { name: string; online: boolean } | null;
  agent: string;
  waitMs: number;
  executionMs: number | null;
  pullRequest: { displayId: string; url: string } | null;
  attention: boolean;
}

interface Cancellable {
  cancelling: boolean;
}

export type RunView =
  | (RunViewBase & Cancellable & { state: "queued"; queuedReason: QueuedReason })
  | (RunViewBase & Cancellable & { state: "running" | "waiting-for-input" | "disconnected" })
  | (RunViewBase & {
      state: "ended";
      endedAt: string;
      endedAgoMs: number;
      agentResult: AgentResult;
      prState: PrState;
      summary: SummaryOutcome;
    });

export interface RunsPage {
  workspace: WorkspaceChoice;
  runs: RunView[];
  recentEnded: number;
  moreEnded: boolean;
  conditions: RunCondition[];
}

export type RunCondition =
  | { key: "runner"; name: string | null }
  | { key: "project"; name: string }
  | { key: "agent"; agent: string }
  | { key: "days"; days: StatsPeriodDays };

export const ENDED_RUNS_PAGE_SIZE = 50;
export const MAX_ENDED_RUNS = 5000;

export const RUN_FILTERS = [
  "all",
  "attention",
  "running",
  "waiting-for-input",
  "disconnected",
  "queued",
  "merged",
  "human-check",
  "failed",
  "canceled",
] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export type RunFilterKey = Exclude<RunFilter, "all" | "attention">;

export function filterKeyOf(run: RunView): RunFilterKey {
  return run.state === "ended" ? run.summary : run.state;
}

export function needsAttention(run: RunView): boolean {
  return run.attention;
}

export function matchesFilter(run: RunView, filter: RunFilter): boolean {
  if (filter === "all") return true;
  if (filter === "attention") return needsAttention(run);
  return filterKeyOf(run) === filter;
}

export function elapsedMs(run: RunView): number {
  return run.executionMs ?? run.waitMs;
}
