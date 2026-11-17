import { describe, expect, it } from "vitest";

import type { PullRequestSnapshot, RepoRef } from "./adapters.js";
import { decidePrState } from "./pr-state.js";

const repo: RepoRef = { owner: "acme", name: "app" };

function pr(overrides: Partial<PullRequestSnapshot> & { number: number }): PullRequestSnapshot {
  return {
    url: `https://example.com/acme/app/pull/${overrides.number}`,
    title: "ENG-1 작업",
    body: "",
    state: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    mergedAt: null,
    headRefName: "factory/ENG-1-1",
    headRepository: repo,
    isCrossRepository: false,
    headSha: "abc",
    baseRefName: "main",
    ci: "none",
    ...overrides,
  };
}

describe("decidePrState", () => {
  it("이어진 PR이 없으면 없음이다", () => {
    expect(decidePrState({ repo, byBranch: [], byTicketKey: [] })).toEqual({
      prState: "none",
      pr: null,
    });
  });

  it.each([
    ["open", "open"],
    ["merged", "merged"],
    ["closed", "closed"],
  ] as const)("PR state %s 는 PR 상태 %s 다", (state, prState) => {
    const only = pr({ number: 1, state });

    expect(decidePrState({ repo, byBranch: [only], byTicketKey: [] })).toEqual({
      prState,
      pr: only,
    });
  });

  it("같은 브랜치에 PR이 여럿이면 가장 최근 것을 쓴다 (스펙 4.2)", () => {
    const older = pr({ number: 1, state: "closed", createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = pr({ number: 2, state: "merged", createdAt: new Date("2026-01-02T00:00:00Z") });

    expect(decidePrState({ repo, byBranch: [newer, older], byTicketKey: [] }).pr).toBe(newer);
    expect(decidePrState({ repo, byBranch: [older, newer], byTicketKey: [] }).pr).toBe(newer);
  });

  it("브랜치로 찾은 PR이 있으면 티켓 키로 찾은 PR보다 먼저 쓴다 (Q40)", () => {
    const byBranch = pr({ number: 1, state: "open" });
    const byKey = pr({ number: 2, state: "merged", createdAt: new Date("2026-02-01T00:00:00Z") });

    expect(decidePrState({ repo, byBranch: [byBranch], byTicketKey: [byKey] }).pr).toBe(byBranch);
  });

  it("브랜치로 찾은 PR이 없으면 티켓 키로 찾은 PR을 쓴다 (Q40)", () => {
    const byKey = pr({ number: 2, state: "merged", headRefName: "other" });

    expect(decidePrState({ repo, byBranch: [], byTicketKey: [byKey] })).toEqual({
      prState: "merged",
      pr: byKey,
    });
  });

  it("포크에서 온 PR과 다른 저장소의 PR은 런과 잇지 않는다 (research 0002 C.2)", () => {
    const fork = pr({
      number: 1,
      isCrossRepository: true,
      headRepository: { owner: "someone", name: "app" },
    });
    const otherRepo = pr({ number: 2, headRepository: { owner: "acme", name: "other" } });

    expect(decidePrState({ repo, byBranch: [fork, otherRepo], byTicketKey: [] })).toEqual({
      prState: "none",
      pr: null,
    });
  });

  it("base 브랜치를 주면 다른 base로 연 PR은 잇지 않는다", () => {
    const toRelease = pr({ number: 1, baseRefName: "release" });

    expect(
      decidePrState({ repo, baseBranch: "main", byBranch: [toRelease], byTicketKey: [] }).prState,
    ).toBe("none");
  });

  it("모르는 PR state는 열림으로 다뤄 워크트리를 지우지 않는다", () => {
    expect(
      decidePrState({ repo, byBranch: [pr({ number: 1, state: "draft-ish" })], byTicketKey: [] })
        .prState,
    ).toBe("open");
  });
});
