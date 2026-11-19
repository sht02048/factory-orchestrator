import { toAgentId, toRunId, toRunnerId, toRunnerProjectId } from "@ganger/core";
import type { QueuedRun, RunnerSnapshot } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { describeQueuedReason, explainQueue } from "@ganger/app/runs/queue-reasons";

const repo = toRunnerProjectId("github:acme/web");
const other = toRunnerProjectId("github:acme/other");
const runnerA = toRunnerId("runner-a");

const queued = (
  id: string,
  minute: number,
  runnerId: string | null,
  project = repo,
): QueuedRun => ({
  id: toRunId(id),
  assignedAt: new Date(minute * 60_000),
  project,
  agent: toAgentId("claude"),
  runnerId: runnerId === null ? null : toRunnerId(runnerId),
  unstartable: false,
});

const runner = (
  id: string,
  online: boolean,
  capacity: number,
  projects = [repo],
): RunnerSnapshot => ({
  id: toRunnerId(id),
  online,
  assignmentBlocked: false,
  capacity,
  projects,
  usageLimits: [],
});

describe("explainQueue", () => {
  it("맨 앞 런의 러너가 꽉 차면 그 런은 capacity 를, 뒤 런은 앞 런을 기다린다(Q63 개정)", () => {
    const reasons = explainQueue({
      queued: [queued("r1", 1, "runner-a"), queued("r2", 2, "runner-b")],
      runners: [runner("runner-a", true, 1), runner("runner-b", true, 1)],
      runs: [{ runnerId: runnerA, state: "running" }],
    });
    expect(reasons.get(toRunId("r1"))).toEqual({ kind: "no-capacity", runnerId: runnerA });
    expect(reasons.get(toRunId("r2"))).toEqual({ kind: "behind" });
  });

  it("남은 capacity 가 있으면 곧 시작한다", () => {
    const reasons = explainQueue({
      queued: [queued("r1", 1, "runner-a"), queued("r2", 2, "runner-b")],
      runners: [runner("runner-a", true, 1), runner("runner-b", true, 1)],
      runs: [],
    });
    expect(reasons.get(toRunId("r1"))).toEqual({ kind: "starting" });
    expect(reasons.get(toRunId("r2"))).toEqual({ kind: "starting" });
  });

  it("맞는 러너가 모두 Offline 이면 순서에서 빠지고 뒤 런을 막지 않는다(Q68·Q72)", () => {
    const reasons = explainQueue({
      queued: [queued("r1", 1, "runner-b", other), queued("r2", 2, "runner-a")],
      runners: [runner("runner-a", true, 1), runner("runner-b", false, 1, [other])],
      runs: [],
    });
    expect(reasons.get(toRunId("r1"))).toEqual({ kind: "runner-offline" });
    expect(reasons.get(toRunId("r2"))).toEqual({ kind: "starting" });
  });

  it("정한 러너가 Offline 이 되면 다른 러너를 정해 다시 판단한다(Q72·Q73)", () => {
    const reasons = explainQueue({
      queued: [queued("r1", 1, "runner-b")],
      runners: [runner("runner-a", true, 1), runner("runner-b", false, 1)],
      runs: [{ runnerId: runnerA, state: "running" }],
    });
    expect(reasons.get(toRunId("r1"))).toEqual({ kind: "no-capacity", runnerId: runnerA });
  });

  it("러너에서 프로젝트가 빠졌거나 GitHub 인증이 깨져 러너를 비운 런은 그 이유로 순서에서 빠진다(Q78·Q82.13·Q87)", () => {
    const projectGone = explainQueue({
      queued: [queued("r1", 1, "runner-a")],
      runners: [runner("runner-a", true, 1, [other])],
      runs: [],
    });
    expect(projectGone.get(toRunId("r1"))).toEqual({ kind: "project-missing" });

    const authBroken = explainQueue({
      queued: [queued("r1", 1, "runner-a"), queued("r2", 2, "runner-b", other)],
      runners: [
        { ...runner("runner-a", true, 1), assignmentBlocked: true },
        runner("runner-b", true, 1, [other]),
      ],
      runs: [],
    });
    expect(authBroken.get(toRunId("r1"))).toEqual({ kind: "assignment-blocked" });
    expect(authBroken.get(toRunId("r2"))).toEqual({ kind: "starting" });
  });

  it("맞는 러너가 모두 런의 공급자 한도에 닿으면 그 공급자와 풀리는 시각을 이유로 남긴다", () => {
    const until = new Date(Date.UTC(2026, 10, 19, 10, 8));
    const reasons = explainQueue({
      queued: [queued("r1", 1, null)],
      runners: [{ ...runner("runner-a", true, 1), usageLimits: [{ provider: "claude", until }] }],
      runs: [],
    });
    expect(reasons.get(toRunId("r1"))).toEqual({ kind: "usage-limit", provider: "claude", until });
  });
});

describe("describeQueuedReason", () => {
  const now = new Date(Date.UTC(2026, 10, 19, 9));
  const name = (id: string) => `name-${id}`;

  it("한도 이유는 지금부터 풀리기까지의 시간으로 바꾼다", () => {
    expect(
      describeQueuedReason(
        { kind: "usage-limit", provider: "claude", until: new Date(now.getTime() + 68 * 60_000) },
        name,
        now,
      ),
    ).toEqual({ kind: "usage-limit", provider: "claude", resetsInMs: 68 * 60_000 });
  });

  it("capacity 이유는 러너 이름을, 나머지는 그대로 둔다", () => {
    expect(describeQueuedReason({ kind: "no-capacity", runnerId: runnerA }, name, now)).toEqual({
      kind: "no-capacity",
      runner: "name-runner-a",
    });
    expect(describeQueuedReason({ kind: "behind" }, name, now)).toEqual({ kind: "behind" });
  });
});
