import { describe, expect, it } from "vitest";
import { addRunDecisionCases, now, seedStatsDatabase } from "../testing/stats-seed";
import { loadStatsPage } from "./load";
import { STATS_DIMENSIONS } from "./model";
import type { StatsGroup, StatsPage, StatsSummary } from "./model";

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
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    expect(page.total.runs).toBe(9);
    expect(page.total.outcomes).toEqual({ merged: 2, "human-check": 3, failed: 4, canceled: 0 });
  });

  it("Failed 런을 에이전트 결과 × PR 상태 조합별로 센다(Q71)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    expect(page.total.failedCombinations).toEqual([
      { agentResult: "reported-failure", prState: "none", runs: 2 },
      { agentResult: "reported-success", prState: "closed", runs: 1 },
      { agentResult: "timed-out", prState: "open", runs: 1 },
    ]);
  });

  it("리드 타임은 할당부터 종료까지이고 대기 시간과 실행 시간을 나눠 잰다(Q59)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    expect(page.total.durations).toEqual({
      leadP50Ms: 22 * min,
      leadP90Ms: 121 * min,
      waitP50Ms: 4 * min,
      executionP50Ms: 20 * min,
    });
  });

  it("Human Check 뒤 병합 비율은 Human Check 런 중 이후 PR 상태가 병합됨인 것이다(Q54·Q69)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    expect(page.total.humanCheck).toEqual({ humanCheck: 3, merged: 1, closed: 1 });
  });

  it("날짜별 처리량은 끝난 날(UTC)로 센다. 할당이 기간 전이어도 기간 안에 끝났으면 넣는다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    expect(page.daily).toHaveLength(14);
    expect(new Date(page.period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(new Date(page.period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
    const nonZero = Object.fromEntries(
      page.daily
        .filter((d) => d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed > 0)
        .map((d) => [new Date(d.day).toISOString().slice(0, 10), d.outcomes]),
    );
    expect(nonZero).toEqual({
      "2026-11-04": { merged: 0, "human-check": 0, failed: 1, canceled: 0 },
      "2026-11-10": { merged: 0, "human-check": 0, failed: 1, canceled: 0 },
      "2026-11-12": { merged: 0, "human-check": 0, failed: 1, canceled: 0 },
      "2026-11-14": { merged: 0, "human-check": 0, failed: 1, canceled: 0 },
      "2026-11-15": { merged: 0, "human-check": 2, failed: 0, canceled: 0 },
      "2026-11-16": { merged: 1, "human-check": 1, failed: 0, canceled: 0 },
      "2026-11-17": { merged: 1, "human-check": 0, failed: 0, canceled: 0 },
    });
  });

  it("날짜는 운영자 시간대로 자른다: 날짜 경계를 넘는 런은 그 시간대의 날짜로 묶인다(0044)", () => {
    const seoul = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "Asia/Seoul"));
    expect(seoul.total.runs).toBe(10);
    const seoulDay = (date: string) =>
      seoul.daily.find((d) => new Date(d.day).toISOString().slice(0, 10) === date)?.outcomes;
    expect(seoulDay("2026-11-04")).toEqual({
      merged: 1,
      "human-check": 0,
      failed: 1,
      canceled: 0,
    });
    const la = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "America/Los_Angeles"));
    expect(new Date(la.period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(la.total.runs).toBe(8);
    expect(la.daily[0]?.outcomes).toEqual({ merged: 0, "human-check": 0, failed: 0, canceled: 0 });
  });

  it("기간의 오늘은 운영자 시간대의 오늘이다", () => {
    const late = new Date("2026-11-17T17:44:00Z");
    const seoul = loaded(loadStatsPage(seedStatsDatabase(), undefined, late, "Asia/Seoul"));
    expect(new Date(seoul.period.lastDay).toISOString()).toBe("2026-11-18T00:00:00.000Z");
    const utc = loaded(loadStatsPage(seedStatsDatabase(), undefined, late, "UTC"));
    expect(new Date(utc.period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("러너·트래커 프로젝트·에이전트별 값을 손으로 계산한 값과 맞춘다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    const runners = byName(page.groups.runner);
    expect(runners.get("runner-a")).toMatchObject({
      runs: 5,
      outcomes: { merged: 2, "human-check": 2, failed: 1, canceled: 0 },
      humanCheck: { humanCheck: 2, merged: 1, closed: 0 },
      durations: { leadP50Ms: 22 * min },
    });
    expect(runners.get("runner-b")).toMatchObject({
      runs: 4,
      outcomes: { merged: 0, "human-check": 1, failed: 3, canceled: 0 },
      humanCheck: { humanCheck: 1, merged: 0, closed: 1 },
      durations: { leadP50Ms: 18 * min },
    });
    expect(page.groups.runner.map((g) => g.name)).toEqual(["runner-a", "runner-b"]);

    const projects = byName(page.groups.trackerProject);
    expect(page.groups.trackerProject.map((g) => g.key).toSorted()).toEqual([
      "conn-acme:tp-api",
      "conn-acme:tp-web",
    ]);
    expect(projects.get("Web")).toMatchObject({
      runs: 6,
      outcomes: { merged: 2, "human-check": 2, failed: 2, canceled: 0 },
    });
    expect(projects.get("API")).toMatchObject({
      runs: 3,
      outcomes: { merged: 0, "human-check": 1, failed: 2, canceled: 0 },
    });

    const agents = byName(page.groups.agent);
    expect(agents.get("claude")).toMatchObject({
      runs: 6,
      outcomes: { merged: 2, "human-check": 1, failed: 3, canceled: 0 },
    });
    expect(agents.get("codex")).toMatchObject({
      runs: 3,
      outcomes: { merged: 0, "human-check": 2, failed: 1, canceled: 0 },
    });
  });

  it.each(STATS_DIMENSIONS)("%s별 합이 전체와 같다", (dimension) => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    const groups = page.groups[dimension];
    expect(groups.length).toBeGreaterThan(1);
    const sum = (pick: (s: StatsSummary) => number) =>
      groups.reduce((total, g) => total + pick(g), 0);
    expect(sum((s) => s.runs)).toBe(page.total.runs);
    expect(sum((s) => s.outcomes.merged)).toBe(page.total.outcomes.merged);
    expect(sum((s) => s.outcomes["human-check"])).toBe(page.total.outcomes["human-check"]);
    expect(sum((s) => s.outcomes.failed)).toBe(page.total.outcomes.failed);
    expect(sum((s) => s.humanCheck.humanCheck)).toBe(page.total.humanCheck.humanCheck);
    expect(sum((s) => s.humanCheck.merged)).toBe(page.total.humanCheck.merged);
    expect(sum((s) => s.humanCheck.closed)).toBe(page.total.humanCheck.closed);
    expect(sum((s) => s.failedCombinations.reduce((n, c) => n + c.runs, 0))).toBe(
      page.total.outcomes.failed,
    );
  });

  it("날짜별 처리량의 합이 전체와 같다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now, "UTC"));
    const daily = page.daily.reduce(
      (n, d) => n + d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed,
      0,
    );
    expect(daily).toBe(page.total.runs);
  });

  it("다른 Workspace 를 고르면 그 Workspace 의 런만 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), "ws-labs", now, "UTC"));
    expect(page.total.runs).toBe(1);
    expect(page.groups.trackerProject.map((g) => g.name)).toEqual(["Lab"]);
  });

  it("전체 보기와 Workspace 가 없을 때는 통계를 읽지 않는다", () => {
    expect(loadStatsPage(seedStatsDatabase(), "all", now, "UTC")).toEqual({
      workspace: { kind: "all" },
    });
  });

  it("기간에 끝난 런이 없으면 0 과 빈 묶음이다", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, later, "UTC"));
    expect(page.total).toEqual({
      runs: 0,
      rated: 0,
      outcomes: { merged: 0, "human-check": 0, failed: 0, canceled: 0 },
      durations: null,
      humanCheck: { humanCheck: 0, merged: 0, closed: 0 },
      failedCombinations: [],
    });
    expect(page.groups.runner).toEqual([]);
    expect(page.daily).toHaveLength(14);
  });

  describe("런 실행 결정(Q82)", () => {
    const withDecisions = () => {
      const db = seedStatsDatabase();
      addRunDecisionCases(db);
      return loaded(loadStatsPage(db, undefined, now, "UTC"));
    };

    it("Canceled 런은 취소로 따로 세고 성공·실패율의 분모에서 뺀다(Q82.9·Q82.18)", () => {
      const page = withDecisions();
      expect(page.total.runs).toBe(13);
      expect(page.total.outcomes).toEqual({ merged: 2, "human-check": 3, failed: 6, canceled: 2 });
      expect(page.total.rated).toBe(11);
      const gemini = byName(page.groups.agent).get("gemini");
      expect(gemini).toMatchObject({ runs: 2, rated: 1 });
      expect(gemini?.outcomes).toEqual({ merged: 0, "human-check": 0, failed: 1, canceled: 1 });
      expect(gemini?.failedCombinations).toEqual([
        { agentResult: "ended-without-report", prState: "none", runs: 1 },
      ]);
    });

    it("시작하지 않고 끝난 런의 대기 시간은 할당부터 끝낸 시각까지이고 실행 시간은 0이다(Q82.9·Q82.20)", () => {
      const aider = byName(withDecisions().groups.agent).get("aider");
      expect(aider?.durations).toEqual({
        leadP50Ms: 5 * min,
        leadP90Ms: 20 * min,
        waitP50Ms: 5 * min,
        executionP50Ms: 0,
      });
    });

    it("Failed 조합에 비정상 종료와 시작할 수 없음이 보인다(Q82.2·Q82.16·Q82.19)", () => {
      expect(withDecisions().total.failedCombinations).toEqual([
        { agentResult: "reported-failure", prState: "none", runs: 2 },
        { agentResult: "reported-success", prState: "closed", runs: 1 },
        { agentResult: "ended-without-report", prState: "none", runs: 1 },
        { agentResult: "timed-out", prState: "open", runs: 1 },
        { agentResult: "could-not-start", prState: "none", runs: 1 },
      ]);
    });

    it("날짜별 처리량에 취소를 따로 센다", () => {
      const day = withDecisions().daily.at(-1);
      expect(day?.outcomes).toEqual({ merged: 1, "human-check": 0, failed: 2, canceled: 2 });
    });
  });
});
