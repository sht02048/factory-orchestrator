import {
  AGENT_RESULTS,
  PR_STATES,
  SUMMARY_OUTCOMES,
  runDurations,
  summarizeRunOutcome,
} from "@factory/core";
import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";
import { DAY_MS, calendarDay } from "../time-zone";

export const STATS_DAYS = 14;

export const STATS_DIMENSIONS = ["runner", "trackerProject", "agent"] as const;
export type StatsDimension = (typeof STATS_DIMENSIONS)[number];

export type OutcomeCounts = Record<SummaryOutcome, number>;

export interface StatsRun {
  runner: GroupKey;
  trackerProject: GroupKey;
  agent: GroupKey;
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
  laterPrState: "merged" | "closed" | null;
  assignedAt: Date;
  startedAt: Date | null;
  endedAt: Date;
}

export interface GroupKey {
  key: string;
  name: string;
}

export interface DurationStats {
  leadP50Ms: number;
  leadP90Ms: number;
  waitP50Ms: number;
  executionP50Ms: number;
}

export interface FailedCombination {
  agentResult: AgentResult;
  prState: PrState;
  runs: number;
}

export interface HumanCheckFollowUp {
  humanCheck: number;
  merged: number;
  closed: number;
}

export interface StatsSummary {
  runs: number;
  rated: number;
  outcomes: OutcomeCounts;
  durations: DurationStats | null;
  humanCheck: HumanCheckFollowUp;
  failedCombinations: FailedCombination[];
}

export interface StatsGroup extends StatsSummary {
  key: string;
  name: string;
}

export interface DailyThroughput {
  day: number;
  outcomes: OutcomeCounts;
}

export type StatsPage =
  | { workspace: Exclude<WorkspaceChoice, { kind: "one" }> }
  | {
      workspace: Extract<WorkspaceChoice, { kind: "one" }>;
      period: { firstDay: number; lastDay: number };
      total: StatsSummary;
      daily: DailyThroughput[];
      groups: Record<StatsDimension, StatsGroup[]>;
    };

export function statsPeriod(now: Date, timeZone: string): { firstDay: number; lastDay: number } {
  const lastDay = calendarDay(now, timeZone);
  return { firstDay: lastDay - (STATS_DAYS - 1) * DAY_MS, lastDay };
}

function emptyOutcomes(): OutcomeCounts {
  return { merged: 0, "human-check": 0, failed: 0, canceled: 0 };
}

export function percentile(sorted: ReadonlyArray<number>, p: number): number {
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new RangeError("percentile of an empty list");
  return value;
}

function sortedNumbers(values: ReadonlyArray<number>): number[] {
  return values.toSorted((a, b) => a - b);
}

export function summarizeStats(runs: ReadonlyArray<StatsRun>): StatsSummary {
  const outcomes = emptyOutcomes();
  const humanCheck: HumanCheckFollowUp = { humanCheck: 0, merged: 0, closed: 0 };
  const failed = new Map<string, FailedCombination>();
  const lead: number[] = [];
  const wait: number[] = [];
  const execution: number[] = [];

  for (const run of runs) {
    const { outcome } = summarizeRunOutcome(run);
    outcomes[outcome] += 1;
    if (outcome === "human-check") {
      humanCheck.humanCheck += 1;
      if (run.laterPrState === "merged") humanCheck.merged += 1;
      if (run.laterPrState === "closed") humanCheck.closed += 1;
    }
    if (outcome === "failed") {
      const key = `${run.agentResult}\u0000${run.prState}`;
      const combination = failed.get(key) ?? {
        agentResult: run.agentResult,
        prState: run.prState,
        runs: 0,
      };
      combination.runs += 1;
      failed.set(key, combination);
    }
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
    if (durations.leadTimeMs !== null) lead.push(durations.leadTimeMs);
    if (durations.waitMs !== null) wait.push(durations.waitMs);
    if (durations.executionMs !== null) execution.push(durations.executionMs);
  }

  const leadSorted = sortedNumbers(lead);
  const waitSorted = sortedNumbers(wait);
  const executionSorted = sortedNumbers(execution);
  return {
    runs: runs.length,
    rated: runs.length - outcomes.canceled,
    outcomes,
    durations:
      leadSorted.length === 0 || waitSorted.length === 0 || executionSorted.length === 0
        ? null
        : {
            leadP50Ms: percentile(leadSorted, 0.5),
            leadP90Ms: percentile(leadSorted, 0.9),
            waitP50Ms: percentile(waitSorted, 0.5),
            executionP50Ms: percentile(executionSorted, 0.5),
          },
    humanCheck,
    failedCombinations: [...failed.values()].toSorted(
      (a, b) =>
        b.runs - a.runs ||
        AGENT_RESULTS.indexOf(a.agentResult) - AGENT_RESULTS.indexOf(b.agentResult) ||
        PR_STATES.indexOf(a.prState) - PR_STATES.indexOf(b.prState),
    ),
  };
}

export function groupStats(runs: ReadonlyArray<StatsRun>, dimension: StatsDimension): StatsGroup[] {
  const groups = new Map<string, { name: string; runs: StatsRun[] }>();
  for (const run of runs) {
    const { key, name } = run[dimension];
    const group = groups.get(key) ?? { name, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]): StatsGroup => ({ key, name: group.name, ...summarizeStats(group.runs) }))
    .toSorted((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
}

export function dailyThroughput(
  runs: ReadonlyArray<StatsRun>,
  period: { firstDay: number; lastDay: number },
  timeZone: string,
): DailyThroughput[] {
  const days: DailyThroughput[] = [];
  for (let day = period.firstDay; day <= period.lastDay; day += DAY_MS) {
    days.push({ day, outcomes: emptyOutcomes() });
  }
  for (const run of runs) {
    const entry = days[(calendarDay(run.endedAt, timeZone) - period.firstDay) / DAY_MS];
    if (entry === undefined) continue;
    entry.outcomes[summarizeRunOutcome(run).outcome] += 1;
  }
  return days;
}

export const OUTCOME_ORDER: ReadonlyArray<SummaryOutcome> = SUMMARY_OUTCOMES;

export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}
