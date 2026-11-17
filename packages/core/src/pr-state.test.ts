import { describe, expect, it } from "vitest";

import type { PullRequestSnapshot } from "./adapters.js";
import { toRepoRef } from "./ids.js";
import { decidePrState } from "./pr-state.js";

const repo = toRepoRef("acme/app");
const runStartedAt = new Date("2026-01-01T00:00:00Z");

function pr(overrides: Partial<PullRequestSnapshot> & { number: number }): PullRequestSnapshot {
  return {
    url: `https://example.com/acme/app/pull/${overrides.number}`,
    title: "ENG-1 작업",
    body: "",
    state: "open",
    createdAt: new Date("2026-01-01T01:00:00Z"),
    mergedAt: null,
    headRefName: "factory/ENG-1-1",
    headRepository: repo,
    headSha: "abc",
    baseRefName: "main",
    ci: "none",
    ...overrides,
  };
}

const decide = (
  byBranch: ReadonlyArray<PullRequestSnapshot>,
  byTicketKey: ReadonlyArray<PullRequestSnapshot> = [],
  baseBranch?: string,
) =>
  decidePrState({
    repo,
    runStartedAt,
    byBranch,
    byTicketKey,
    ...(baseBranch === undefined ? {} : { baseBranch }),
  });

describe("decidePrState", () => {
  it("이어진 PR이 없으면 없음이다", () => {
    expect(decide([])).toEqual({ prState: "none", pr: null });
  });

  it.each([
    ["open", "open"],
    ["merged", "merged"],
    ["closed", "closed"],
  ] as const)("PR state %s 는 PR 상태 %s 다", (state, prState) => {
    const only = pr({ number: 1, state });

    expect(decide([only])).toEqual({ prState, pr: only });
  });

  it("같은 브랜치에 PR이 여럿이면 가장 최근 것을 쓴다 (스펙 4.2)", () => {
    const older = pr({ number: 1, state: "closed", createdAt: new Date("2026-01-01T01:00:00Z") });
    const newer = pr({ number: 2, state: "merged", createdAt: new Date("2026-01-02T00:00:00Z") });

    expect(decide([newer, older]).pr).toBe(newer);
    expect(decide([older, newer]).pr).toBe(newer);
  });

  it("브랜치로 찾은 PR이 있으면 티켓 키로 찾은 PR보다 먼저 쓴다 (Q40)", () => {
    const byBranch = pr({ number: 1, state: "open" });
    const byKey = pr({ number: 2, state: "merged", createdAt: new Date("2026-02-01T00:00:00Z") });

    expect(decide([byBranch], [byKey]).pr).toBe(byBranch);
  });

  it("브랜치로 찾은 PR이 없으면 티켓 키로 찾은 PR을 쓴다 (Q40)", () => {
    const byKey = pr({ number: 2, state: "merged", headRefName: "other" });

    expect(decide([], [byKey])).toEqual({ prState: "merged", pr: byKey });
  });

  it("티켓 키로 찾은 PR 중 런이 시작하기 전에 만든 것(같은 티켓의 앞 런 PR)은 잇지 않는다", () => {
    const previousRun = pr({
      number: 1,
      state: "merged",
      headRefName: "factory/ENG-1-0",
      createdAt: new Date("2025-12-31T00:00:00Z"),
    });

    expect(decide([], [previousRun])).toEqual({ prState: "none", pr: null });
  });

  it("포크에서 온 PR과 head 저장소가 사라진 PR은 런과 잇지 않는다 (research 0002 C.2)", () => {
    const fork = pr({ number: 1, headRepository: toRepoRef("someone/app") });
    const deleted = pr({ number: 2, headRepository: null });

    expect(decide([fork, deleted])).toEqual({ prState: "none", pr: null });
  });

  it("base 브랜치를 주면 다른 base로 연 PR은 잇지 않는다", () => {
    expect(decide([pr({ number: 1, baseRefName: "release" })], [], "main").prState).toBe("none");
  });

  it("모르는 PR state는 열림으로 다뤄 워크트리를 지우지 않는다", () => {
    expect(decide([pr({ number: 1, state: "draft-ish" })]).prState).toBe("open");
  });
});
