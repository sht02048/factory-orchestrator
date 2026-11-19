import { describe, expect, it } from "vitest";

import { type MainPullRequest, mainPullRequestVerdict, releaseSource } from "./branch-flow.ts";

describe("releaseSource", () => {
  it("develop 은 develop 출처다", () => {
    expect(releaseSource("develop")).toEqual({ kind: "develop" });
  });

  it("hotfix 브랜치는 hotfix 출처다", () => {
    expect(releaseSource("hotfix/login-crash")).toEqual({
      kind: "hotfix",
      branch: "hotfix/login-crash",
    });
    expect(releaseSource("hotfix/0.1.1/tray")).toEqual({
      kind: "hotfix",
      branch: "hotfix/0.1.1/tray",
    });
  });

  it("그 밖의 브랜치는 거절한다", () => {
    for (const source of [
      "main",
      "release/v0.2.0",
      "feature/x",
      "developer",
      "hotfix",
      "hotfix/",
    ]) {
      expect(() => releaseSource(source)).toThrow("takes develop or a hotfix/* branch");
    }
  });

  it("셸이나 git 이 다르게 읽을 이름은 거절한다", () => {
    for (const source of [
      "hotfix/a b",
      "hotfix/$(id)",
      "hotfix/a..b",
      "hotfix/-x",
      "hotfix/a//b",
      "hotfix/x.lock",
      "hotfix/a;rm",
    ]) {
      expect(() => releaseSource(source)).toThrow("takes develop or a hotfix/* branch");
    }
  });
});

describe("mainPullRequestVerdict", () => {
  const releasePr: MainPullRequest = {
    baseRef: "main",
    headRef: "release/v0.2.0",
    sameRepository: true,
    developExists: true,
    headContainsMain: true,
  };

  it("main 이 아닌 곳으로 가는 PR 은 건너뛴다", () => {
    expect(
      mainPullRequestVerdict({ ...releasePr, baseRef: "develop", headRef: "feature/x" }).kind,
    ).toBe("skip");
  });

  it("develop 이 아직 없으면 건너뛴다", () => {
    expect(
      mainPullRequestVerdict({
        ...releasePr,
        headRef: "chore/0114-develop-branch-flow",
        developExists: false,
        headContainsMain: false,
      }),
    ).toEqual({ kind: "skip", reason: "the develop branch does not exist yet" });
  });

  it("최신 main 을 담은 release·hotfix 브랜치는 통과한다", () => {
    expect(mainPullRequestVerdict(releasePr).kind).toBe("pass");
    expect(mainPullRequestVerdict({ ...releasePr, headRef: "hotfix/tray" }).kind).toBe("pass");
  });

  it("release·hotfix 가 아닌 브랜치는 실패한다", () => {
    for (const headRef of ["develop", "feature/x", "sync/main-to-develop", "release", "hotfix/"]) {
      const verdict = mainPullRequestVerdict({ ...releasePr, headRef });
      expect(verdict.kind).toBe("fail");
      expect(verdict.reason).toContain("Open feature work against develop");
    }
  });

  it("포크의 release 브랜치는 실패한다", () => {
    const verdict = mainPullRequestVerdict({ ...releasePr, sameRepository: false });
    expect(verdict).toEqual({
      kind: "fail",
      reason:
        "pull requests to main come only from release/* or hotfix/* branches of this repository, not a fork's release/v0.2.0. Open feature work against develop",
    });
  });

  it("최신 main 을 담지 않으면 실패한다", () => {
    expect(mainPullRequestVerdict({ ...releasePr, headContainsMain: false })).toEqual({
      kind: "fail",
      reason:
        "release/v0.2.0 does not contain the latest main. Merge main into it so this pull request does not undo a hotfix",
    });
  });
});
