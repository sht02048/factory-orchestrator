import { PR_STATES, SUMMARY_OUTCOMES, runDurations, summarizeRunOutcome } from "@ganger/core";
import type { AgentResult, PrState, SummaryOutcome } from "@ganger/core";
import { z } from "zod";
import type { WorkspaceChoice } from "../shell/model.js";
import { DAY_MS, calendarDay } from "../time-zone.js";

export const STATS_PERIOD_DAYS = [7, 14, 30] as const;
export type StatsPeriodDays = (typeof STATS_PERIOD_DAYS)[number];
export const DEFAULT_STATS_PERIOD_DAYS: StatsPeriodDays = 14;
export const statsPeriodDaysSchema = z.literal(STATS_PERIOD_DAYS);

export const STATS_DIMENSIONS = ["runner", "trackerProject", "agent"] as const;
export type StatsDimension = (typeof STATS_DIMENSIONS)[number];

export const FAILURE_REASONS = [
  "reported-failure",
  "no-pr",
  "pr-closed",
  "ended-without-report",
  "timed-out",
  "stopped-waiting-for-input",
  "runner-disconnected",
  "worktree-missing",
  "could-not-start",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export type OutcomeCounts = Record<SummaryOutcome, number>;
export type PrStateCounts = Record<PrState, number>;

export interface StatsRun {
  runner: GroupKey;
  trackerProject: GroupKey;
  agent: GroupKey;
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
  assignedAt: Date;
  startedAt: Date | null;
  endedAt: Date;
}

export interface GroupKey {
  key: string;
  name: string;
}

export interface LeadTimeStats {
  p50Ms: number;
  p90Ms: number;
}

export interface FailureReasonCount {
  reason: FailureReason;
  runs: number;
  prStates: PrStateCounts;
}

export interface StatsSummary {
  runs: number;
  rated: number;
  outcomes: OutcomeCounts;
  leadTime: LeadTimeStats | null;
  failureReasons: FailureReasonCount[];
}

export interface StatsGroup extends StatsSummary {
  key: string;
  name: string;
}

export interface DailyThroughput {
  day: number;
  outcomes: OutcomeCounts;
}

export interface StatsPeriod {
  days: StatsPeriodDays;
  firstDay: number;
  lastDay: number;
}

export type StatsPage =
  | { workspace: Exclude<WorkspaceChoice, { kind: "one" }> }
  | {
      workspace: Extract<WorkspaceChoice, { kind: "one" }>;
      period: StatsPeriod;
      total: StatsSummary;
      previous: StatsSummary;
      daily: DailyThroughput[];
      groups: Record<StatsDimension, StatsGroup[]>;
    };

export function statsPeriod(now: Date, timeZone: string, days: StatsPeriodDays): StatsPeriod {
  const lastDay = calendarDay(now, timeZone);
  return { days, firstDay: lastDay - (days - 1) * DAY_MS, lastDay };
}

export function previousPeriod(period: StatsPeriod): StatsPeriod {
  return {
    days: period.days,
    firstDay: period.firstDay - period.days * DAY_MS,
    lastDay: period.firstDay - DAY_MS,
  };
}

export function inPeriod(day: number, period: StatsPeriod): boolean {
  return day >= period.firstDay && day <= period.lastDay;
}

export function failureReasonOf(agentResult: AgentResult, prState: PrState): FailureReason | null {
  switch (agentResult) {
    case "reported-success":
      if (prState === "none") return "no-pr";
      if (prState === "closed") return "pr-closed";
      return null;
    case "reported-failure":
    case "ended-without-report":
    case "timed-out":
    case "stopped-waiting-for-input":
    case "runner-disconnected":
    case "worktree-missing":
    case "could-not-start":
      return agentResult;
    case "canceled":
      return null;
  }
}

function emptyOutcomes(): OutcomeCounts {
  return { merged: 0, "human-check": 0, failed: 0, canceled: 0 };
}

function emptyPrStates(): PrStateCounts {
  return { none: 0, open: 0, merged: 0, closed: 0 };
}

export function percentile(sorted: ReadonlyArray<number>, p: number): number {
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new RangeError("percentile of an empty list");
  return value;
}

export function summarizeStats(runs: ReadonlyArray<StatsRun>): StatsSummary {
  const outcomes = emptyOutcomes();
  const reasons = new Map<FailureReason, FailureReasonCount>();
  const lead: number[] = [];

  for (const run of runs) {
    const { outcome } = summarizeRunOutcome(run);
    outcomes[outcome] += 1;
    if (outcome === "failed") {
      const reason = failureReasonOf(run.agentResult, run.prState);
      if (reason !== null) {
        const count = reasons.get(reason) ?? { reason, runs: 0, prStates: emptyPrStates() };
        count.runs += 1;
        count.prStates[run.prState] += 1;
        reasons.set(reason, count);
      }
    }
    const { leadTimeMs } = runDurations({
      assignedAt: run.assignedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
    if (leadTimeMs !== null) lead.push(leadTimeMs);
  }

  const leadSorted = lead.toSorted((a, b) => a - b);
  return {
    runs: runs.length,
    rated: runs.length - outcomes.canceled,
    outcomes,
    leadTime:
      leadSorted.length === 0
        ? null
        : { p50Ms: percentile(leadSorted, 0.5), p90Ms: percentile(leadSorted, 0.9) },
    failureReasons: [...reasons.values()].toSorted(
      (a, b) =>
        b.runs - a.runs || FAILURE_REASONS.indexOf(a.reason) - FAILURE_REASONS.indexOf(b.reason),
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
  period: StatsPeriod,
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
export const PR_STATE_ORDER: ReadonlyArray<PrState> = PR_STATES;

export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

export function mergedRate(summary: StatsSummary): number | null {
  return percent(summary.outcomes.merged, summary.rated);
}

export function humanTouchedRate(summary: StatsSummary): number | null {
  return percent(summary.outcomes["human-check"] + summary.outcomes.failed, summary.rated);
}

export function mergedRateChange(current: StatsSummary, previous: StatsSummary): number | null {
  const now = mergedRate(current);
  const before = mergedRate(previous);
  return now === null || before === null ? null : now - before;
}
