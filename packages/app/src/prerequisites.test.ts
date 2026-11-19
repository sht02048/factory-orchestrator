import { describe, expect, it } from "vitest";
import { runnerWideChecks, summarizePushChecks } from "./prerequisites.js";

const push = (
  project: string,
  satisfied: boolean | null,
  failure: { kind: "auth" | "network" | "timeout" | "other"; reason: string | null } | null = null,
) => ({ id: `github-push:github:acme/${project}`, project, satisfied, failure });

describe("summarizePushChecks", () => {
  it("묶어서 통과 수와 실패·모름 목록, 실패 종류를 한 번씩 돌려준다 (0096)", () => {
    const checks = [
      { id: "orca-service", project: null, satisfied: true, failure: null },
      push("a", true),
      push("b", false, { kind: "auth", reason: "Permission to acme/b.git denied" }),
      push("c", false, { kind: "auth", reason: null }),
      push("d", false, { kind: "network", reason: "Could not resolve host: github.com" }),
      push("e", null, { kind: "timeout", reason: null }),
    ];

    expect(summarizePushChecks(checks)).toEqual({
      total: 5,
      passed: 1,
      failed: [
        {
          id: "github-push:github:acme/b",
          project: "b",
          failure: { kind: "auth", reason: "Permission to acme/b.git denied" },
        },
        { id: "github-push:github:acme/c", project: "c", failure: { kind: "auth", reason: null } },
        {
          id: "github-push:github:acme/d",
          project: "d",
          failure: { kind: "network", reason: "Could not resolve host: github.com" },
        },
      ],
      unknown: [
        {
          id: "github-push:github:acme/e",
          project: "e",
          failure: { kind: "timeout", reason: null },
        },
      ],
      failedKinds: ["auth", "network"],
    });
    expect(runnerWideChecks(checks).map((check) => check.id)).toEqual(["orca-service"]);
  });

  it("이름을 모르는 프로젝트는 러너 쪽 프로젝트 id로 부른다", () => {
    expect(summarizePushChecks([{ ...push("x", false), project: null }]).failed[0]?.project).toBe(
      "github:acme/x",
    );
  });
});
