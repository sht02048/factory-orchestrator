import { describe, expect, it } from "vitest";
import { now, seedStatsDatabase } from "../testing/stats-seed";
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

/*
 * 손으로 계산한 값. 런과 시간은 testing/stats-seed.ts 의 statsCases 에 있다.
 *
 * 기간(11월 4일~17일 UTC)에 끝난 ws-commerce 런 아홉:
 *   Merged C-1, C-8 / Human Check C-2(이후 병합), C-3(이후 닫힘), C-4 / Failed C-5, C-6, C-7, C-9
 * 리드 타임(분, 대기 + 실행): 10 15 18 20 22 30 34 50 121 → 중앙값 5번째 22, p90 9번째 121
 * 대기(분): 1 2 2 3 4 5 6 8 10 → 중앙값 4 / 실행(분): 8 10 12 15 20 24 30 40 120 → 중앙값 20
 * 세지 않는 런: OLD-1(11월 3일에 끝남), C-10(실행 중), LAB-1(다른 Workspace)
 */
describe("loadStatsPage", () => {
  it("처리량과 요약 결과 분포를 core 요약 계산으로 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(page.total.runs).toBe(9);
    expect(page.total.outcomes).toEqual({ merged: 2, "human-check": 3, failed: 4 });
  });

  it("Failed 런을 에이전트 결과 × PR 상태 조합별로 센다(Q71)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(page.total.failedCombinations).toEqual([
      { agentResult: "exited-with-error", prState: "none", runs: 2 },
      { agentResult: "exited-normally", prState: "closed", runs: 1 },
      { agentResult: "timed-out", prState: "open", runs: 1 },
    ]);
  });

  it("리드 타임은 할당부터 종료까지이고 대기 시간과 실행 시간을 나눠 잰다(Q59)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(page.total.durations).toEqual({
      leadP50Ms: 22 * min,
      leadP90Ms: 121 * min,
      waitP50Ms: 4 * min,
      executionP50Ms: 20 * min,
    });
  });

  it("Human Check 뒤 병합 비율은 Human Check 런 중 이후 PR 상태가 병합됨인 것이다(Q54·Q69)", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(page.total.humanCheck).toEqual({ humanCheck: 3, merged: 1, closed: 1 });
  });

  it("날짜별 처리량은 끝난 날(UTC)로 센다. 할당이 기간 전이어도 기간 안에 끝났으면 넣는다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(page.daily).toHaveLength(14);
    expect(new Date(page.period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(new Date(page.period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
    const nonZero = Object.fromEntries(
      page.daily
        .filter((d) => d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed > 0)
        .map((d) => [new Date(d.day).toISOString().slice(0, 10), d.outcomes]),
    );
    expect(nonZero).toEqual({
      "2026-11-04": { merged: 0, "human-check": 0, failed: 1 },
      "2026-11-10": { merged: 0, "human-check": 0, failed: 1 },
      "2026-11-12": { merged: 0, "human-check": 0, failed: 1 },
      "2026-11-14": { merged: 0, "human-check": 0, failed: 1 },
      "2026-11-15": { merged: 0, "human-check": 2, failed: 0 },
      "2026-11-16": { merged: 1, "human-check": 1, failed: 0 },
      "2026-11-17": { merged: 1, "human-check": 0, failed: 0 },
    });
  });

  it("러너·트래커 프로젝트·에이전트별 값을 손으로 계산한 값과 맞춘다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    const runners = byName(page.groups.runner);
    // runner-a: C-1 C-2 C-4 C-7 C-8, 리드 타임 15 20 22 30 34 → 중앙값 22
    expect(runners.get("runner-a")).toMatchObject({
      runs: 5,
      outcomes: { merged: 2, "human-check": 2, failed: 1 },
      humanCheck: { humanCheck: 2, merged: 1, closed: 0 },
      durations: { leadP50Ms: 22 * min },
    });
    // runner-b: C-3 C-5 C-6 C-9, 리드 타임 10 18 50 121 → 중앙값 2번째 18
    expect(runners.get("runner-b")).toMatchObject({
      runs: 4,
      outcomes: { merged: 0, "human-check": 1, failed: 3 },
      humanCheck: { humanCheck: 1, merged: 0, closed: 1 },
      durations: { leadP50Ms: 18 * min },
    });
    expect(page.groups.runner.map((g) => g.name)).toEqual(["runner-a", "runner-b"]);

    const projects = byName(page.groups.trackerProject);
    // 고른 묶음은 주소(sel)에 남으므로 키는 주소에 안전한 글자만 쓴다
    expect(page.groups.trackerProject.map((g) => g.key).toSorted()).toEqual([
      "conn-acme:tp-api",
      "conn-acme:tp-web",
    ]);
    expect(projects.get("Web")).toMatchObject({
      runs: 6,
      outcomes: { merged: 2, "human-check": 2, failed: 2 },
    });
    expect(projects.get("API")).toMatchObject({
      runs: 3,
      outcomes: { merged: 0, "human-check": 1, failed: 2 },
    });

    const agents = byName(page.groups.agent);
    expect(agents.get("claude")).toMatchObject({
      runs: 6,
      outcomes: { merged: 2, "human-check": 1, failed: 3 },
    });
    expect(agents.get("codex")).toMatchObject({
      runs: 3,
      outcomes: { merged: 0, "human-check": 2, failed: 1 },
    });
  });

  it.each(STATS_DIMENSIONS)("%s별 합이 전체와 같다", (dimension) => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
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
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, now));
    const daily = page.daily.reduce(
      (n, d) => n + d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed,
      0,
    );
    expect(daily).toBe(page.total.runs);
  });

  it("다른 Workspace 를 고르면 그 Workspace 의 런만 센다", () => {
    const page = loaded(loadStatsPage(seedStatsDatabase(), "ws-labs", now));
    expect(page.total.runs).toBe(1);
    expect(page.groups.trackerProject.map((g) => g.name)).toEqual(["Lab"]);
  });

  it("전체 보기와 Workspace 가 없을 때는 통계를 읽지 않는다", () => {
    expect(loadStatsPage(seedStatsDatabase(), "all", now)).toEqual({
      workspace: { kind: "all" },
    });
  });

  it("기간에 끝난 런이 없으면 0 과 빈 묶음이다", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    const page = loaded(loadStatsPage(seedStatsDatabase(), undefined, later));
    expect(page.total).toEqual({
      runs: 0,
      outcomes: { merged: 0, "human-check": 0, failed: 0 },
      durations: null,
      humanCheck: { humanCheck: 0, merged: 0, closed: 0 },
      failedCombinations: [],
    });
    expect(page.groups.runner).toEqual([]);
    expect(page.daily).toHaveLength(14);
  });
});
