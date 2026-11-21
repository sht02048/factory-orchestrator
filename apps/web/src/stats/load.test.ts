import { listRuns, updateRunRecords } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { addRunDecisionCases, now, seedStatsDatabase } from "../testing/stats-seed";
import { loadStatsPage } from "@ganger/app/stats/load";
import { STATS_DIMENSIONS } from "@ganger/app/stats/model";
import type { StatsGroup, StatsPage, StatsSummary } from "@ganger/app/stats/model";

const min = 60_000;

function loaded(page: StatsPage): Extract<StatsPage, { total: StatsSummary }> {
  if (!("total" in page)) throw new Error(`no stats for ${page.workspace.kind}`);
  return page;
}

function byName(groups: ReadonlyArray<StatsGroup>): Map<string, StatsGroup> {
  return new Map(groups.map((g) => [g.name, g]));
}

describe("loadStatsPage", () => {
  it("처리량과 요약 결과 분포를 core 요약 계산으로 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    expect(page.total.runs).toBe(9);
    expect(page.total.outcomes).toEqual({ succeeded: 5, failed: 4, canceled: 0 });
  });

  it("PR 병합 수는 요약 결과와 따로, 끝날 때나 그 뒤에 병합된 PR 로 센다 (R5)", () => {
    const db = seedStatsDatabase();
    const page = loaded(loadStatsPage(db, undefined, now, "UTC", 14));
    expect(page.total.prMerged).toBe(3);
    const later = listRuns(db).find((run) => run.ticket.key === "C-4");
    if (later === undefined) throw new Error("no C-4");
    updateRunRecords(db, later.id, { laterPrState: { state: "merged", at: now } });
    const after = loaded(loadStatsPage(db, undefined, now, "UTC", 14));
    expect(after.total.prMerged).toBe(4);
    expect(after.total.outcomes).toEqual(page.total.outcomes);
    expect(byName(after.groups.runner).get("runner-a")?.prMerged).toBe(4);
  });

  it("Failed 런을 실패 이유별로 세고 이유마다 PR 상태를 함께 센다(0068)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    expect(page.total.failureReasons).toEqual([
      {
        reason: "reported-failure",
        runs: 3,
        prStates: { none: 2, open: 1, merged: 0, closed: 0, unknown: 0 },
      },
      {
        reason: "timed-out",
        runs: 1,
        prStates: { none: 0, open: 1, merged: 0, closed: 0, unknown: 0 },
      },
    ]);
  });

  it("리드 타임은 할당부터 종료까지의 중앙값과 p90이다(Q59)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    expect(page.total.leadTime).toEqual({ p50Ms: 22 * min, p90Ms: 121 * min });
  });

  it("앞 기간은 같은 길이의 바로 앞 기간이다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    expect(page.period.days).toBe(14);
    expect(page.previous.runs).toBe(1);
    expect(page.previous.outcomes).toEqual({ succeeded: 1, failed: 0, canceled: 0 });
  });

  it("기간을 7일로 바꾸면 그 7일과 바로 앞 7일만 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 7));
    expect(new Date(page.period.firstDay).toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(page.daily).toHaveLength(7);
    expect(page.total.runs).toBe(7);
    expect(page.total.outcomes).toEqual({ succeeded: 4, failed: 3, canceled: 0 });
    expect(page.previous.runs).toBe(2);
    expect(page.previous.outcomes).toEqual({ succeeded: 1, failed: 1, canceled: 0 });
    expect(page.groups.runner.reduce((n, g) => n + g.runs, 0)).toBe(7);
  });

  it("30일이면 앞 기간까지 60일 안의 런을 읽는다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 30));
    expect(page.daily).toHaveLength(30);
    expect(page.total.runs).toBe(10);
    expect(page.previous.runs).toBe(0);
  });

  it("날짜별 처리량은 끝난 날(UTC)로 센다. 할당이 기간 전이어도 기간 안에 끝났으면 넣는다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    expect(page.daily).toHaveLength(14);
    expect(new Date(page.period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(new Date(page.period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
    const nonZero = Object.fromEntries(
      page.daily
        .filter((d) => d.outcomes.succeeded + d.outcomes.failed > 0)
        .map((d) => [new Date(d.day).toISOString().slice(0, 10), d.outcomes]),
    );
    expect(nonZero).toEqual({
      "2026-11-04": { succeeded: 1, failed: 0, canceled: 0 },
      "2026-11-10": { succeeded: 0, failed: 1, canceled: 0 },
      "2026-11-12": { succeeded: 0, failed: 1, canceled: 0 },
      "2026-11-14": { succeeded: 0, failed: 1, canceled: 0 },
      "2026-11-15": { succeeded: 2, failed: 0, canceled: 0 },
      "2026-11-16": { succeeded: 1, failed: 1, canceled: 0 },
      "2026-11-17": { succeeded: 1, failed: 0, canceled: 0 },
    });
  });

  it("날짜는 운영자 시간대로 자른다: 날짜 경계를 넘는 런은 그 시간대의 날짜로 묶인다(0044)", () => {
    const seoul = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "Asia/Seoul", 14));
    expect(seoul.total.runs).toBe(10);
    const seoulDay = (date: string) =>
      seoul.daily.find((d) => new Date(d.day).toISOString().slice(0, 10) === date)?.outcomes;
    expect(seoulDay("2026-11-04")).toEqual({ succeeded: 2, failed: 0, canceled: 0 });
    const la = loaded(
      loadStatsPage(seedStatsDatabase(), undefined, now, "America/Los_Angeles", 14),
    );
    expect(new Date(la.period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(la.total.runs).toBe(8);
    expect(la.daily[0]?.outcomes).toEqual({ succeeded: 0, failed: 0, canceled: 0 });
  });

  it("기간의 오늘은 운영자 시간대의 오늘이다", () => {
    const late = new Date("2026-11-17T17:44:00Z");
    const seoul = loaded(loadStatsPage(seedStatsDatabase(), undefined, late, "Asia/Seoul", 14));
    expect(new Date(seoul.period.lastDay).toISOString()).toBe("2026-11-18T00:00:00.000Z");
    const utc = loaded(loadStatsPage(seedStatsDatabase(), undefined, late, "UTC", 14));
    expect(new Date(utc.period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("러너·트래커 프로젝트·에이전트별 값을 손으로 계산한 값과 맞춘다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    const runners = byName(page.groups.runner);
    expect(runners.get("runner-a")).toMatchObject({
      runs: 5,
      outcomes: { succeeded: 4, failed: 1, canceled: 0 },
      prMerged: 3,
      leadTime: { p50Ms: 22 * min },
    });
    expect(runners.get("runner-b")).toMatchObject({
      runs: 4,
      outcomes: { succeeded: 1, failed: 3, canceled: 0 },
      prMerged: 0,
      leadTime: { p50Ms: 18 * min },
    });
    expect(page.groups.runner.map((g) => g.name)).toEqual(["runner-a", "runner-b"]);

    const projects = byName(page.groups.trackerProject);
    expect(page.groups.trackerProject.map((g) => g.key).toSorted()).toEqual([
      "conn-acme:tp-api",
      "conn-acme:tp-web",
    ]);
    expect(projects.get("Web")).toMatchObject({
      runs: 6,
      outcomes: { succeeded: 4, failed: 2, canceled: 0 },
    });
    expect(projects.get("API")).toMatchObject({
      runs: 3,
      outcomes: { succeeded: 1, failed: 2, canceled: 0 },
    });

    const agents = byName(page.groups.agent);
    expect(agents.get("claude")).toMatchObject({
      runs: 6,
      outcomes: { succeeded: 2, failed: 4, canceled: 0 },
    });
    expect(agents.get("codex")).toMatchObject({
      runs: 3,
      outcomes: { succeeded: 3, failed: 0, canceled: 0 },
    });
  });

  it.each(STATS_DIMENSIONS)("%s별 합이 전체와 같다", (dimension) => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    const groups = page.groups[dimension];
    expect(groups.length).toBeGreaterThan(1);
    const sum = (pick: (s: StatsSummary) => number) =>
      groups.reduce((total, g) => total + pick(g), 0);
    expect(sum((s) => s.runs)).toBe(page.total.runs);
    expect(sum((s) => s.outcomes.succeeded)).toBe(page.total.outcomes.succeeded);
    expect(sum((s) => s.prMerged)).toBe(page.total.prMerged);
    expect(sum((s) => s.outcomes.failed)).toBe(page.total.outcomes.failed);
    expect(sum((s) => s.failureReasons.reduce((n, c) => n + c.runs, 0))).toBe(
      page.total.outcomes.failed,
    );
  });

  it("날짜별 처리량의 합이 전체와 같다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", 14));
    const daily = page.daily.reduce((n, d) => n + d.outcomes.succeeded + d.outcomes.failed, 0);
    expect(daily).toBe(page.total.runs);
  });

  it("다른 Workspace 를 고르면 그 Workspace 의 런만 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), "ws-labs", now, "UTC", 14));
    expect(page.total.runs).toBe(1);
    expect(page.groups.trackerProject.map((g) => g.name)).toEqual(["Lab"]);
  });

  it("전체 보기와 Workspace 가 없을 때는 통계를 읽지 않는다", () => {
    expect(loadStatsPage(seedStatsDatabase(), "all", now, "UTC", 14)).toEqual({
      workspace: { kind: "all" },
    });
  });

  it("기간에 끝난 런이 없으면 0 과 빈 묶음이다", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, later, "UTC", 14));
    expect(page.total).toEqual({
      runs: 0,
      rated: 0,
      outcomes: { succeeded: 0, failed: 0, canceled: 0 },
      prMerged: 0,
      leadTime: null,
      failureReasons: [],
    });
    expect(page.groups.runner).toEqual([]);
    expect(page.daily).toHaveLength(14);
  });

  describe("런 실행 결정(Q82)", () => {
    const withDecisions = () => {
      const db = seedStatsDatabase();
      addRunDecisionCases(db);
      return loaded(loadStatsPage(db, undefined, now, "UTC", 14));
    };

    it("Canceled 런은 취소로 따로 세고 성공·실패율의 분모에서 뺀다(Q82.9·Q82.18)", () => {
      const page = withDecisions();
      expect(page.total.runs).toBe(13);
      expect(page.total.outcomes).toEqual({ succeeded: 5, failed: 6, canceled: 2 });
      expect(page.total.rated).toBe(11);
      const gemini = byName(page.groups.agent).get("gemini");
      expect(gemini).toMatchObject({ runs: 2, rated: 1 });
      expect(gemini?.outcomes).toEqual({ succeeded: 0, failed: 1, canceled: 1 });
      expect(gemini?.failureReasons.map((r) => r.reason)).toEqual(["ended-without-report"]);
    });

    it("시작하지 않고 끝난 런의 리드 타임은 할당부터 끝낸 시각까지다(Q82.9·Q82.20)", () => {
      const aider = byName(withDecisions().groups.agent).get("aider");
      expect(aider?.leadTime).toEqual({ p50Ms: 5 * min, p90Ms: 20 * min });
    });

    it("실패 이유에 중간에 멈춤과 시작하지 못함이 보이고 취소는 빠진다(Q82.2·Q82.16·Q82.19)", () => {
      expect(withDecisions().total.failureReasons.map((r) => [r.reason, r.runs])).toEqual([
        ["reported-failure", 3],
        ["ended-without-report", 1],
        ["timed-out", 1],
        ["could-not-start", 1],
      ]);
    });

    it("날짜별 처리량에 취소를 따로 센다", () => {
      const day = withDecisions().daily.at(-1);
      expect(day?.outcomes).toEqual({ succeeded: 1, failed: 2, canceled: 2 });
    });
  });
});
