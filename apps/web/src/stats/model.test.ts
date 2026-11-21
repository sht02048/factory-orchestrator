import { describe, expect, it } from "vitest";
import { DAY_MS } from "@ganger/app/time-zone";
import {
  failureReasonOf,
  successRateChange,
  percent,
  percentile,
  previousPeriod,
  statsPeriod,
  successRate,
  summarizeStats,
} from "@ganger/app/stats/model";
import type { StatsRun } from "@ganger/app/stats/model";

describe("percentile", () => {
  it("nearest-rank: n 개 중 ceil(p × n) 번째 값이다", () => {
    expect(percentile([10], 0.5)).toBe(10);
    expect(percentile([10, 20], 0.5)).toBe(10);
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)).toBe(10);
  });

  it("빈 목록은 던진다", () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });
});

describe("statsPeriod", () => {
  it("오늘(UTC)을 넣어 14일이다", () => {
    const period = statsPeriod(new Date("2026-11-17T23:59:59Z"), "UTC", 14);
    expect(new Date(period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(new Date(period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("운영자 시간대의 오늘을 넣는다", () => {
    const period = statsPeriod(new Date("2026-11-17T23:59:59Z"), "Asia/Seoul", 14);
    expect(new Date(period.firstDay).toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(new Date(period.lastDay).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });
});

describe("percent", () => {
  it("정수로 반올림하고 분모가 0 이면 null 이다", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });
});

describe("previousPeriod", () => {
  it.each([7, 14, 30] as const)("%i일 기간의 앞 기간은 첫날 바로 전날까지 같은 길이다", (days) => {
    const period = statsPeriod(new Date("2026-11-17T12:00:00Z"), "UTC", days);
    const previous = previousPeriod(period);
    expect(previous.lastDay).toBe(period.firstDay - DAY_MS);
    expect((previous.lastDay - previous.firstDay) / DAY_MS + 1).toBe(days);
  });
});

describe("successRateChange", () => {
  const run = (agentResult: StatsRun["agentResult"], prState: StatsRun["prState"]): StatsRun => ({
    runner: { key: "r", name: "r" },
    trackerProject: { key: "p", name: "p" },
    agent: { key: "a", name: "a" },
    agentResult,
    prState,
    prMerged: prState === "merged",
    runnerUnreached: false,
    assignedAt: new Date(0),
    startedAt: new Date(0),
    endedAt: new Date(60_000),
  });
  const merged = run("reported-success", "merged");
  const succeededWithoutPr = run("reported-success", "none");
  const failed = run("reported-failure", "merged");
  const canceled = run("canceled", "none");

  it("두 기간 성공률의 차이를 %p로 준다", () => {
    expect(
      successRateChange(summarizeStats([merged, merged, failed]), summarizeStats([merged, failed])),
    ).toBe(17);
    expect(successRateChange(summarizeStats([failed]), summarizeStats([merged, failed]))).toBe(-50);
  });

  it("성공률은 에이전트 보고로만 세고, PR 병합 수는 따로 센다 (R1·R5)", () => {
    const summary = summarizeStats([merged, succeededWithoutPr, failed]);
    expect(summary.outcomes).toEqual({ succeeded: 2, failed: 1, canceled: 0 });
    expect(summary.prMerged).toBe(2);
    expect(successRate(summary)).toBe(67);
  });

  it("Canceled 는 두 기간 모두 비율에서 뺀다", () => {
    expect(
      successRateChange(summarizeStats([merged, canceled]), summarizeStats([merged, failed])),
    ).toBe(50);
  });

  it("어느 한 기간에 비율을 낼 런이 없으면 null 이다", () => {
    expect(successRateChange(summarizeStats([merged]), summarizeStats([]))).toBeNull();
    expect(successRateChange(summarizeStats([]), summarizeStats([merged]))).toBeNull();
    expect(successRateChange(summarizeStats([merged]), summarizeStats([canceled]))).toBeNull();
  });
});

describe("failureReasonOf", () => {
  it("성공을 보고한 런과 취소한 런은 실패 이유가 없다", () => {
    expect(failureReasonOf("reported-success")).toBeNull();
    expect(failureReasonOf("canceled")).toBeNull();
  });

  it("그 밖의 에이전트 결과는 결과 하나가 이유 하나다", () => {
    expect(failureReasonOf("reported-failure")).toBe("reported-failure");
    expect(failureReasonOf("ended-without-report")).toBe("ended-without-report");
    expect(failureReasonOf("could-not-start")).toBe("could-not-start");
  });
});
