import { toRunId, toRunnerId, toRunnerProjectId } from "@factory/core";
import type { QueuedRun, RunnerSnapshot } from "@factory/core";
import { describe, expect, it } from "vitest";
import { explainQueue } from "./queue-reasons";

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
  runnerId: runnerId === null ? null : toRunnerId(runnerId),
});

const runner = (
  id: string,
  online: boolean,
  capacity: number,
  projects = [repo],
): RunnerSnapshot => ({
  id: toRunnerId(id),
  online,
  capacity,
  projects,
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
});
