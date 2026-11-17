import {
  AGENT_RESULTS,
  PR_STATES,
  SUMMARY_OUTCOMES,
  runDurations,
  summarizeRunOutcome,
} from "@factory/core";
import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";

/*
 * Stats 화면이 보이는 값과 그 계산. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값과 숫자만 담는다. 문구는 메시지 파일이 정한다.
 *
 * - 요약 결과는 core summarizeRunOutcome 으로만 정한다(Q66·Q76).
 * - 리드 타임·대기 시간·실행 시간은 core runDurations 로 잰다(Q59).
 */

/** 통계를 보는 기간. 오늘(UTC)을 넣어 이 날 수만큼 거슬러 끝난 런을 센다 */
export const STATS_DAYS = 14;

/** 나눠 보기(티켓 0002): 러너별, 트래커 프로젝트별, 에이전트별 */
export const STATS_DIMENSIONS = ["runner", "trackerProject", "agent"] as const;
export type StatsDimension = (typeof STATS_DIMENSIONS)[number];

export type OutcomeCounts = Record<SummaryOutcome, number>;

/** 런 하나를 통계에 넣을 때 쓰는 값. Ended 런만 넣는다 */
export interface StatsRun {
  runner: GroupKey;
  trackerProject: GroupKey;
  agent: GroupKey;
  agentResult: AgentResult;
  prState: PrState;
  /** 이후 PR 상태(Q54·Q69). 런이 끝난 뒤 사람이 병합하거나 닫지 않았으면 null */
  laterPrState: "merged" | "closed" | null;
  assignedAt: Date;
  startedAt: Date;
  endedAt: Date;
}

export interface GroupKey {
  /** 묶는 기준. 이름이 같아도 기준이 다르면 다른 묶음이다 */
  key: string;
  name: string;
}

/** 시간 분포. 값은 밀리초이고, 런이 없으면 StatsSummary.durations 가 null 이다 */
export interface DurationStats {
  /** 할당(Queued 포함)부터 종료까지(Q59) */
  leadP50Ms: number;
  leadP90Ms: number;
  /** 할당부터 시작까지 */
  waitP50Ms: number;
  /** 시작부터 종료까지 */
  executionP50Ms: number;
}

/** Failed 런의 에이전트 결과 × PR 상태 조합 하나(Q71) */
export interface FailedCombination {
  agentResult: AgentResult;
  prState: PrState;
  runs: number;
}

/** Human Check 런의 이후 PR 상태(Q54·Q69). 아직 열린 PR 은 humanCheck - merged - closed */
export interface HumanCheckFollowUp {
  humanCheck: number;
  merged: number;
  closed: number;
}

export interface StatsSummary {
  runs: number;
  outcomes: OutcomeCounts;
  durations: DurationStats | null;
  humanCheck: HumanCheckFollowUp;
  /** 런이 많은 조합부터. 같으면 에이전트 결과, PR 상태의 정의 순서 */
  failedCombinations: FailedCombination[];
}

export interface StatsGroup extends StatsSummary {
  key: string;
  name: string;
}

export interface DailyThroughput {
  /** UTC 날짜의 0시(epoch 밀리초) */
  day: number;
  outcomes: OutcomeCounts;
}

export type StatsPage =
  | { workspace: Exclude<WorkspaceChoice, { kind: "one" }> }
  | {
      workspace: Extract<WorkspaceChoice, { kind: "one" }>;
      /** 기간: 첫날 0시와 마지막 날 0시(UTC, epoch 밀리초) */
      period: { firstDay: number; lastDay: number };
      total: StatsSummary;
      /** 기간의 날마다 하나, 오래된 날부터 */
      daily: DailyThroughput[];
      groups: Record<StatsDimension, StatsGroup[]>;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

/** 그 시각이 든 UTC 날짜의 0시 */
export function utcDay(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS) * DAY_MS;
}

/** 오늘(UTC)까지 STATS_DAYS 일. 이 기간에 끝난 런을 센다 */
export function statsPeriod(now: Date): { firstDay: number; lastDay: number } {
  const lastDay = utcDay(now);
  return { firstDay: lastDay - (STATS_DAYS - 1) * DAY_MS, lastDay };
}

function emptyOutcomes(): OutcomeCounts {
  return { merged: 0, "human-check": 0, failed: 0 };
}

/**
 * 정렬한 값의 백분위수(nearest-rank). 값 n 개 중 ceil(p × n) 번째 값이다.
 * 짝수 개의 중앙값은 가운데 둘 중 앞 값이라, 손으로 셀 때도 실제 런 하나의 값이 나온다.
 */
export function percentile(sorted: ReadonlyArray<number>, p: number): number {
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new RangeError("percentile of an empty list");
  return value;
}

function sortedNumbers(values: ReadonlyArray<number>): number[] {
  return values.toSorted((a, b) => a - b);
}

/** 런 묶음 하나의 요약 결과 분포, 시간, Human Check 뒤 병합, Failed 조합 */
export function summarizeStats(runs: ReadonlyArray<StatsRun>): StatsSummary {
  const outcomes = emptyOutcomes();
  const humanCheck: HumanCheckFollowUp = { humanCheck: 0, merged: 0, closed: 0 };
  const failed = new Map<string, FailedCombination>();
  const lead: number[] = [];
  const wait: number[] = [];
  const execution: number[] = [];

  for (const run of runs) {
    const { outcome } = summarizeRunOutcome(run.agentResult, run.prState);
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

/** 기준 하나로 런을 나눠 묶음마다 요약한다. 런이 많은 묶음부터, 같으면 이름 순 */
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

/** 날마다 끝난 런 수(처리량)를 요약 결과로 나눈다. 런이 없는 날도 0 으로 둔다 */
export function dailyThroughput(
  runs: ReadonlyArray<StatsRun>,
  period: { firstDay: number; lastDay: number },
): DailyThroughput[] {
  const days: DailyThroughput[] = [];
  for (let day = period.firstDay; day <= period.lastDay; day += DAY_MS) {
    days.push({ day, outcomes: emptyOutcomes() });
  }
  for (const run of runs) {
    const entry = days[(utcDay(run.endedAt) - period.firstDay) / DAY_MS];
    if (entry === undefined) continue;
    entry.outcomes[summarizeRunOutcome(run.agentResult, run.prState).outcome] += 1;
  }
  return days;
}

/** 요약 결과 셋을 정해진 순서로 돈다(Merged, Human Check, Failed) */
export const OUTCOME_ORDER: ReadonlyArray<SummaryOutcome> = SUMMARY_OUTCOMES;

/** 비율을 정수 퍼센트로. 분모가 0 이면 null */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}
