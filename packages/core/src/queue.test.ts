import { describe, expect, it } from "vitest";

import type { RunnerSnapshot } from "./assignment.js";
import { pickRunner } from "./assignment.js";
import { toRunId, toRunnerId, toRunnerProjectId } from "./ids.js";
import type { RunId, RunnerId } from "./ids.js";
import { planQueue } from "./queue.js";
import type { QueuedRun } from "./queue.js";
import type { RunState } from "./run.js";

const app = toRunnerProjectId("github:acme/app");
const web = toRunnerProjectId("github:acme/web");
const r1 = toRunnerId("r1");
const r2 = toRunnerId("r2");

function runner(overrides: Partial<RunnerSnapshot> & Pick<RunnerSnapshot, "id">): RunnerSnapshot {
  return { online: true, capacity: 1, projects: [app], ...overrides };
}

let minute = 0;
function queued(id: string, project: typeof app, runnerId: RunnerId | null): QueuedRun {
  minute += 1;
  return {
    id: toRunId(id),
    project,
    runnerId,
    assignedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
  };
}

const busy = (runnerId: RunnerId, state: RunState = "running") => ({ runnerId, state });
const ids = (...values: string[]): RunId[] => values.map(toRunId);

describe("planQueue", () => {
  it("빈 대기열은 아무것도 하지 않는다", () => {
    expect(planQueue({ queued: [], runners: [runner({ id: r1 })], runs: [] })).toEqual({
      cleared: [],
      assigned: [],
      start: [],
    });
  });

  it("들어온 순서대로 남은 capacity만큼 시작한다", () => {
    const a = queued("a", app, r1);
    const b = queued("b", app, r1);
    const c = queued("c", app, r1);

    const plan = planQueue({
      queued: [c, a, b],
      runners: [runner({ id: r1, capacity: 2 })],
      runs: [],
    });

    expect(plan.start).toEqual([
      { runId: a.id, runnerId: r1 },
      { runId: b.id, runnerId: r1 },
    ]);
  });

  it("맨 앞 런의 러너가 꽉 차면 다른 러너의 뒤 런도 기다린다 (Q63 개정)", () => {
    const head = queued("head", app, r1);
    const behind = queued("behind", web, r2);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1 }), runner({ id: r2, projects: [web] })],
      runs: [busy(r1)],
    });

    expect(plan.start).toEqual([]);
  });

  it("Disconnected 런도 러너를 꽉 채워 맨 앞 런을 기다리게 한다 (Q74)", () => {
    const head = queued("head", app, r1);

    const plan = planQueue({
      queued: [head],
      runners: [runner({ id: r1 })],
      runs: [busy(r1, "disconnected")],
    });

    expect(plan.start).toEqual([]);
  });

  it("맞는 러너가 모두 Offline이면 러너 없는 Queued가 되고, 러너가 Online이 되면 그 러너로 정한다 (Q65·Q68)", () => {
    const offline = [runner({ id: r1, online: false })];
    expect(pickRunner({ project: app, runners: offline, runs: [] })).toBeNull();

    const run = queued("a", app, null);
    const stillOffline = planQueue({ queued: [run], runners: offline, runs: [] });
    expect(stillOffline).toEqual({ cleared: [], assigned: [], start: [] });

    const online = planQueue({ queued: [run], runners: [runner({ id: r1 })], runs: [] });
    expect(online.assigned).toEqual([{ runId: run.id, runnerId: r1 }]);
    expect(online.start).toEqual([{ runId: run.id, runnerId: r1 }]);
  });

  it("러너 없는 Queued 런이 맨 앞에 있어도 뒤 런이 시작한다 (Q68)", () => {
    const head = queued("head", app, null);
    const behind = queued("behind", web, r2);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1, online: false }), runner({ id: r2, projects: [web] })],
      runs: [],
    });

    expect(plan.assigned).toEqual([]);
    expect(plan.start).toEqual([{ runId: behind.id, runnerId: r2 }]);
  });

  it("정한 러너가 Offline이 된 Queued 런은 러너를 비우고 뒤 런을 막지 않는다 (Q72)", () => {
    const head = queued("head", app, r1);
    const behind = queued("behind", web, r2);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1, online: false }), runner({ id: r2, projects: [web] })],
      runs: [],
    });

    expect(plan.cleared).toEqual(ids("head"));
    expect(plan.start).toEqual([{ runId: behind.id, runnerId: r2 }]);
  });

  it("등록에서 사라진 러너도 Offline처럼 비운다", () => {
    const head = queued("head", app, toRunnerId("gone"));

    const plan = planQueue({ queued: [head], runners: [runner({ id: r1 })], runs: [] });

    expect(plan.cleared).toEqual(ids("head"));
    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r1 }]);
  });

  it("다른 맞는 러너가 Online이면 비운 런에 바로 그 러너를 정한다 (Q72·Q73)", () => {
    const head = queued("head", app, r1);

    const plan = planQueue({
      queued: [head],
      runners: [runner({ id: r1, online: false }), runner({ id: r2 })],
      runs: [],
    });

    expect(plan.cleared).toEqual(ids("head"));
    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r2 }]);
    expect(plan.start).toEqual([{ runId: head.id, runnerId: r2 }]);
  });

  it("러너가 Online이 되면 비웠던 런이 원래 자리로 돌아가 뒤 런보다 먼저 시작한다 (Q73)", () => {
    // head는 r1이 Offline이 되어 러너를 비운 런이고, later는 그 뒤에 들어와 r1을 정한 런이다.
    const head = queued("head", app, null);
    const later = queued("later", app, r1);

    const plan = planQueue({
      queued: [later, head],
      runners: [runner({ id: r1, capacity: 1 })],
      runs: [],
    });

    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r1 }]);
    expect(plan.start).toEqual([{ runId: head.id, runnerId: r1 }]);
  });

  it("돌아온 런의 러너에 capacity가 없으면 그 런이 맨 앞에서 뒤 런을 기다리게 한다 (Q73·Q63 개정)", () => {
    const head = queued("head", app, null);
    const behind = queued("behind", web, r2);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1 }), runner({ id: r2, projects: [web] })],
      runs: [busy(r1)],
    });

    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r1 }]);
    expect(plan.start).toEqual([]);
  });

  it("앞 런이 이번에 시작한 것을 남은 capacity에 넣고 다음 런의 러너를 고른다", () => {
    const a = queued("a", app, null);
    const b = queued("b", app, null);

    const plan = planQueue({
      queued: [a, b],
      runners: [runner({ id: r1, capacity: 1 }), runner({ id: r2, capacity: 1 })],
      runs: [],
    });

    expect(plan.assigned).toEqual([
      { runId: a.id, runnerId: r1 },
      { runId: b.id, runnerId: r2 },
    ]);
    expect(plan.start).toEqual([
      { runId: a.id, runnerId: r1 },
      { runId: b.id, runnerId: r2 },
    ]);
  });
});
