import { describe, expect, it } from "vitest";

import type { PullRequestSnapshot } from "./adapters.js";
import { toPullRequestId, toRepoRef, toTicketKey } from "./ids.js";
import { decidePrState, mentionsTicketKey } from "./pr-state.js";

const repo = toRepoRef("acme/app");
const runStartedAt = new Date("2026-01-01T00:00:00Z");

function pr(
  overrides: Omit<Partial<PullRequestSnapshot>, "id"> & { number: number },
): PullRequestSnapshot {
  const { number, ...rest } = overrides;
  return {
    id: toPullRequestId(`pr-${number}`),
    displayId: `#${number}`,
    url: `https://example.com/acme/app/pull/${number}`,
    title: "ENG-1 작업",
    body: "",
    state: "open",
    createdAt: new Date("2026-01-01T01:00:00Z"),
    mergedAt: null,
    headBranch: "factory/ENG-1-1",
    sourceRepo: repo,
    headCommit: "abc",
    baseBranch: "main",
    ci: "none",
    ...rest,
  };
}

const decide = (
  byBranch: ReadonlyArray<PullRequestSnapshot>,
  byTicketKey: ReadonlyArray<PullRequestSnapshot> = [],
  baseBranch?: string,
) =>
  decidePrState({
    repo,
    ticketKey: toTicketKey("ENG-1"),
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

  it("만든 시각이 같으면 목록에서 뒤에 있는 PR을 쓴다", () => {
    const first = pr({ number: 9 });
    const second = pr({ number: 1 });

    expect(decide([first, second]).pr).toBe(second);
  });

  it("브랜치로 찾은 PR이 있으면 티켓 키로 찾은 PR보다 먼저 쓴다 (Q40)", () => {
    const byBranch = pr({ number: 1, state: "open" });
    const byKey = pr({ number: 2, state: "merged", createdAt: new Date("2026-02-01T00:00:00Z") });

    expect(decide([byBranch], [byKey]).pr).toBe(byBranch);
  });

  it("브랜치로 찾은 PR이 없으면 티켓 키로 찾은 PR을 쓴다 (Q40)", () => {
    const byKey = pr({ number: 2, state: "merged", headBranch: "other" });

    expect(decide([], [byKey])).toEqual({ prState: "merged", pr: byKey });
  });

  it("티켓 키로 찾은 PR 중 런이 시작하기 전에 만든 것(같은 티켓의 앞 런 PR)은 잇지 않는다", () => {
    const previousRun = pr({
      number: 1,
      state: "merged",
      headBranch: "factory/ENG-1-0",
      createdAt: new Date("2025-12-31T00:00:00Z"),
    });

    expect(decide([], [previousRun])).toEqual({ prState: "none", pr: null });
  });

  it("포크에서 온 PR과 head 저장소가 사라진 PR은 런과 잇지 않는다 (research 0002 C.2)", () => {
    const fork = pr({ number: 1, sourceRepo: toRepoRef("someone/app") });
    const deleted = pr({ number: 2, sourceRepo: null });

    expect(decide([fork, deleted])).toEqual({ prState: "none", pr: null });
  });

  it("base 브랜치를 주면 다른 base로 연 PR은 잇지 않는다", () => {
    expect(decide([pr({ number: 1, baseBranch: "release" })], [], "main").prState).toBe("none");
  });

  it("모르는 PR state는 열림으로 다뤄 워크트리를 지우지 않는다", () => {
    expect(decide([pr({ number: 1, state: "draft-ish" })]).prState).toBe("open");
  });

  it("브랜치로 찾은 PR이 닫힘뿐이면 티켓 키로 찾은 PR을 본다: 브랜치 이름을 바꿔 다시 연 PR (research 0006 17절)", () => {
    const renamedAway = pr({ number: 1, state: "closed" });
    const reopened = pr({
      number: 2,
      state: "open",
      headBranch: "renamed",
      createdAt: new Date("2026-01-01T02:00:00Z"),
    });

    expect(decide([renamedAway], [reopened])).toEqual({ prState: "open", pr: reopened });
  });

  it("브랜치로 찾은 PR이 닫힘이고 티켓 키로도 찾지 못하면 닫힘이다", () => {
    const closed = pr({ number: 1, state: "closed" });

    expect(decide([closed], [])).toEqual({ prState: "closed", pr: closed });
  });

  it("티켓 키로 찾은 PR 중 제목에 키가 있는 PR을 본문에만 있는 PR보다 먼저 쓴다 (research 0006 17절)", () => {
    const inTitle = pr({ number: 1, title: "ENG-1 고치기", headBranch: "a" });
    const bodyOnly = pr({
      number: 2,
      title: "고치기",
      body: "ENG-1",
      headBranch: "b",
      createdAt: new Date("2026-01-01T03:00:00Z"),
    });

    expect(decide([], [bodyOnly, inTitle]).pr).toBe(inTitle);
  });

  it("CI 상태(볼 수 없음 포함)는 PR 상태를 바꾸지 않는다 (Q79)", () => {
    for (const ci of ["unavailable", "none", "failure", "success"] as const) {
      expect(decide([pr({ number: 1, state: "merged", ci })]).prState).toBe("merged");
    }
  });
});

describe("mentionsTicketKey", () => {
  it("키를 낱말 경계로 대소문자 없이 찾는다 (research 0006 20절)", () => {
    const key = toTicketKey("ENG-123");

    expect(mentionsTicketKey("fix eng-123 now", key)).toBe(true);
    expect(mentionsTicketKey("[ENG-123]", key)).toBe(true);
    expect(mentionsTicketKey("ENG-1234", key)).toBe(false);
    expect(mentionsTicketKey("ENG cleanup for 123 items", key)).toBe(false);
  });
});

describe("이어서 맡긴 런의 PR", () => {
  const startedAt = new Date("2026-11-21T10:00:00Z");
  const before = new Date("2026-11-21T09:00:00Z");
  const during = new Date("2026-11-21T11:00:00Z");
  const snapshot = (
    state: "open" | "merged" | "closed",
    mergedAt: Date | null,
  ): PullRequestSnapshot => ({
    id: toPullRequestId("pr-1"),
    displayId: "#1",
    url: "https://code.example.com/acme/pull/1",
    title: "change",
    body: "",
    state,
    createdAt: before,
    mergedAt,
    headBranch: "acme/branch",
    sourceRepo: repo,
    headCommit: "abc",
    baseBranch: "main",
    ci: "success",
  });
  const decide = (found: PullRequestSnapshot) =>
    decidePrState({
      repo,
      ticketKey: toTicketKey("ENG-1"),
      runStartedAt: startedAt,
      continuesEarlierRun: true,
      byBranch: [found],
      byTicketKey: [],
    }).prState;

  it("이전 런 때 이미 머지되거나 닫힌 PR은 새 런의 결과로 삼지 않는다", () => {
    expect(decide(snapshot("merged", before))).toBe("none");
    expect(decide(snapshot("closed", null))).toBe("none");
  });

  it("런 중에 머지되거나 아직 열린 PR은 새 런의 결과다", () => {
    expect(decide(snapshot("merged", during))).toBe("merged");
    expect(decide(snapshot("open", null))).toBe("open");
  });
});
