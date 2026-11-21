import { describe, expect, it } from "vitest";

import type { RunnerSnapshot } from "./assignment.js";
import { pickRunner } from "./assignment.js";
import { toAgentId, toRunId, toRunnerId, toRunnerProjectId } from "./ids.js";
import type { RunId, RunnerId } from "./ids.js";
import { planQueue } from "./queue.js";
import type { QueuedRun } from "./queue.js";
import type { RunState } from "./run.js";

const app = toRunnerProjectId("github:acme/app");
const web = toRunnerProjectId("github:acme/web");
const claude = toAgentId("claude");
const r1 = toRunnerId("r1");
const r2 = toRunnerId("r2");

function runner(overrides: Partial<RunnerSnapshot> & Pick<RunnerSnapshot, "id">): RunnerSnapshot {
  return {
    online: true,
    assignmentBlocked: false,
    capacity: 1,
    projects: [app],
    usageLimits: [],
    ...overrides,
  };
}

let minute = 0;
function queued(
  id: string,
  project: typeof app,
  runnerId: RunnerId | null,
  unstartable = false,
): QueuedRun {
  minute += 1;
  return {
    id: toRunId(id),
    project,
    agent: claude,
    runnerId,
    assignedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    unstartable,
  };
}

const EMPTY_PLAN = { cleared: [], assigned: [], unplaced: [], couldNotStart: [], start: [] };

const busy = (runnerId: RunnerId, state: RunState = "running") => ({ runnerId, state });
const ids = (...values: string[]): RunId[] => values.map(toRunId);

describe("planQueue", () => {
  it("빈 대기열은 아무것도 하지 않는다", () => {
    expect(planQueue({ queued: [], runners: [runner({ id: r1 })], runs: [] })).toEqual(EMPTY_PLAN);
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
    expect(pickRunner({ project: app, agent: claude, runners: offline, runs: [] })).toBeNull();

    const run = queued("a", app, null);
    const stillOffline = planQueue({ queued: [run], runners: offline, runs: [] });
    expect(stillOffline).toEqual({
      ...EMPTY_PLAN,
      unplaced: [{ runId: run.id, reason: "runner-offline" }],
    });

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

    expect(plan.cleared).toEqual([{ runId: head.id, reason: "runner-offline" }]);
    expect(plan.unplaced).toEqual([{ runId: head.id, reason: "runner-offline" }]);
    expect(plan.start).toEqual([{ runId: behind.id, runnerId: r2 }]);
  });

  it("등록에서 사라진 러너도 Offline처럼 비운다", () => {
    const head = queued("head", app, toRunnerId("gone"));

    const plan = planQueue({ queued: [head], runners: [runner({ id: r1 })], runs: [] });

    expect(plan.cleared.map((c) => c.runId)).toEqual(ids("head"));
    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r1 }]);
  });

  it("다른 맞는 러너가 Online이면 비운 런에 바로 그 러너를 정한다 (Q72·Q73)", () => {
    const head = queued("head", app, r1);

    const plan = planQueue({
      queued: [head],
      runners: [runner({ id: r1, online: false }), runner({ id: r2 })],
      runs: [],
    });

    expect(plan.cleared.map((c) => c.runId)).toEqual(ids("head"));
    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r2 }]);
    expect(plan.start).toEqual([{ runId: head.id, runnerId: r2 }]);
  });

  it("러너가 Online이 되면 비웠던 런이 원래 자리로 돌아가 뒤 런보다 먼저 시작한다 (Q73)", () => {
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

  it("정한 러너에서 러너 쪽 프로젝트가 사라진 Queued 런은 러너를 비우고 순서에서 빠졌다가, 맞는 러너가 생기면 원래 자리로 돌아온다 (Q78)", () => {
    const head = queued("head", app, r1);
    const behind = queued("behind", web, r2);
    const projectGone = [runner({ id: r1, projects: [web] }), runner({ id: r2, projects: [web] })];

    const gone = planQueue({ queued: [head, behind], runners: projectGone, runs: [] });
    expect(gone.cleared).toEqual([{ runId: head.id, reason: "project-missing" }]);
    expect(gone.unplaced).toEqual([{ runId: head.id, reason: "project-missing" }]);
    expect(gone.start).toEqual([{ runId: behind.id, runnerId: r2 }]);

    const later = queued("later", web, r2);
    const back = planQueue({
      queued: [later, { ...head, runnerId: null }],
      runners: [runner({ id: r1, projects: [web] }), runner({ id: r2, projects: [app, web] })],
      runs: [],
    });
    expect(back.assigned).toEqual([{ runId: head.id, runnerId: r2 }]);
    expect(back.start[0]).toEqual({ runId: head.id, runnerId: r2 });
  });

  it("GitHub 인증이 깨진 러너는 고르지 않고, 그 러너로 정한 Queued 런은 러너를 비우고 순서에서 빠진다 (Q82.14·Q82.22)", () => {
    const head = queued("head", app, r1);
    const behind = queued("behind", web, r2);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1, assignmentBlocked: true }), runner({ id: r2, projects: [web] })],
      runs: [],
    });

    expect(plan.cleared).toEqual([{ runId: head.id, reason: "assignment-blocked" }]);
    expect(plan.unplaced).toEqual([{ runId: head.id, reason: "assignment-blocked" }]);
    expect(plan.assigned).toEqual([]);
    expect(plan.start).toEqual([{ runId: behind.id, runnerId: r2 }]);
  });

  it("인증이 깨진 러너로 정한 런은 인증이 멀쩡한 다른 맞는 러너로 다시 정한다 (Q82.22·Q73)", () => {
    const head = queued("head", app, r1);

    const plan = planQueue({
      queued: [head],
      runners: [runner({ id: r1, assignmentBlocked: true }), runner({ id: r2 })],
      runs: [],
    });

    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r2 }]);
    expect(plan.start).toEqual([{ runId: head.id, runnerId: r2 }]);
  });

  it("정한 러너에서 런의 프로젝트 push가 깨지면 러너를 비우고 다른 맞는 러너로 다시 정한다 (0096)", () => {
    const head = queued("head", app, r1);
    const other = queued("other", web, r1);

    const plan = planQueue({
      queued: [head, other],
      runners: [
        runner({ id: r1, capacity: 2, projects: [app, web], blockedProjects: [app] }),
        runner({ id: r2 }),
      ],
      runs: [],
    });

    expect(plan.cleared).toEqual([{ runId: head.id, reason: "assignment-blocked" }]);
    expect(plan.assigned).toEqual([{ runId: head.id, runnerId: r2 }]);
    expect(plan.start).toEqual([
      { runId: head.id, runnerId: r2 },
      { runId: other.id, runnerId: r1 },
    ]);
  });

  it("맞는 러너가 모두 그 프로젝트의 push가 깨졌으면 이유는 할당 막힘이다 (0096)", () => {
    const a = queued("a", app, null);

    expect(
      planQueue({ queued: [a], runners: [runner({ id: r1, blockedProjects: [app] })], runs: [] })
        .unplaced,
    ).toEqual([{ runId: a.id, reason: "assignment-blocked" }]);
  });

  it("순서에서 빠진 이유를 맞는 러너의 상태로 가른다 (Q68·Q82.13·Q87)", () => {
    const a = queued("a", app, null);
    const reasonWith = (runners: RunnerSnapshot[]) =>
      planQueue({ queued: [a], runners, runs: [] }).unplaced;

    expect(reasonWith([runner({ id: r1, online: false })])).toEqual([
      { runId: a.id, reason: "runner-offline" },
    ]);
    expect(
      reasonWith([runner({ id: r1, online: false }), runner({ id: r2, assignmentBlocked: true })]),
    ).toEqual([{ runId: a.id, reason: "assignment-blocked" }]);
    expect(reasonWith([runner({ id: r1, projects: [web] })])).toEqual([
      { runId: a.id, reason: "project-missing" },
    ]);
  });

  it("맞는 러너가 모두 런의 공급자 한도에 닿았으면 가장 빨리 풀리는 한도를 이유로 남긴다", () => {
    const a = queued("a", app, null);
    const soon = { provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 10, 8)) };
    const late = { provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 12)) };

    const plan = planQueue({
      queued: [a],
      runners: [
        runner({ id: r1, usageLimits: [late] }),
        runner({ id: r2, usageLimits: [soon] }),
        runner({ id: toRunnerId("r3"), assignmentBlocked: true }),
      ],
      runs: [],
    });

    expect(plan.unplaced).toEqual([{ runId: a.id, reason: "usage-limit", limit: soon }]);
    expect(plan.start).toEqual([]);
  });

  it("한도에 닿지 않은 러너가 있으면 그 러너로 정하고, 다른 공급자의 한도는 보지 않는다", () => {
    const a = queued("a", app, null);
    const codexLimit = { provider: "codex", until: new Date(Date.UTC(2026, 10, 19, 10)) };
    const claudeLimit = { provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 10)) };

    const plan = planQueue({
      queued: [a],
      runners: [
        runner({ id: r1, capacity: 3, usageLimits: [claudeLimit] }),
        runner({ id: r2, usageLimits: [codexLimit] }),
      ],
      runs: [],
    });

    expect(plan.assigned).toEqual([{ runId: a.id, runnerId: r2 }]);
  });

  it("이미 러너를 정한 런은 그 러너가 한도에 닿아도 바꾸지 않는다(수동 할당을 막지 않는다)", () => {
    const a = queued("a", app, r1);
    const limit = { provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 10)) };

    const plan = planQueue({
      queued: [a],
      runners: [runner({ id: r1, usageLimits: [limit] }), runner({ id: r2 })],
      runs: [],
    });

    expect(plan.cleared).toEqual([]);
    expect(plan.start).toEqual([{ runId: a.id, runnerId: r1 }]);
  });

  it("맨 앞 런이 영영 시작할 수 없으면 시작할 수 없음으로 끝내 뒤 런이 막히지 않는다 (Q82.16)", () => {
    const head = queued("head", app, r1, true);
    const behind = queued("behind", app, r1);

    const plan = planQueue({
      queued: [head, behind],
      runners: [runner({ id: r1 })],
      runs: [],
    });

    expect(plan.couldNotStart).toEqual(ids("head"));
    expect(plan.start).toEqual([{ runId: behind.id, runnerId: r1 }]);
  });

  it("시작할 수 없는 런도 앞 런이 막혀 있으면 맨 앞이 될 때까지 기다린다", () => {
    const head = queued("head", app, r1);
    const stuck = queued("stuck", app, r1, true);

    const plan = planQueue({
      queued: [head, stuck],
      runners: [runner({ id: r1 })],
      runs: [busy(r1)],
    });

    expect(plan.couldNotStart).toEqual([]);
    expect(plan.start).toEqual([]);
  });
});

describe("이어서 맡긴 런(러너 고정)", () => {
  it("러너가 Offline 이면 다른 러너로 옮기지 않고 기다리며 뒤 런을 막지 않는다", () => {
    const pinned = { ...queued("pinned", app, r1), pinnedToRunner: true };
    const next = queued("next", app, null);
    const plan = planQueue({
      queued: [pinned, next],
      runners: [runner({ id: r1, online: false }), runner({ id: r2 })],
      runs: [],
    });
    expect(plan.cleared).toEqual([]);
    expect(plan.unplaced).toEqual([{ runId: pinned.id, reason: "runner-offline" }]);
    expect(plan.start).toEqual([{ runId: next.id, runnerId: r2 }]);
  });

  it("러너에 남은 capacity 가 없으면 대기열 순서대로 기다린다", () => {
    const pinned = { ...queued("pinned", app, r1), pinnedToRunner: true };
    const plan = planQueue({
      queued: [pinned],
      runners: [runner({ id: r1 }), runner({ id: r2 })],
      runs: [{ runnerId: r1, state: "running" }],
    });
    expect(plan.assigned).toEqual([]);
    expect(plan.start).toEqual([]);
  });

  it("러너가 그 에이전트의 사용량 한도에 닿았으면 시작하지 않고 한도 이유로 기다린다", () => {
    const pinned = { ...queued("pinned", app, r1), pinnedToRunner: true };
    const until = new Date("2099-01-01T00:00:00Z");
    const plan = planQueue({
      queued: [pinned],
      runners: [runner({ id: r1, usageLimits: [{ provider: "claude", until }] })],
      runs: [],
    });
    expect(plan.start).toEqual([]);
    expect(plan.unplaced).toEqual([
      { runId: pinned.id, reason: "usage-limit", limit: { provider: "claude", until } },
    ]);
  });

  it("시작을 이미 요청한 런은 한도 중에도 시작 여부를 확인하러 간다", () => {
    const pinned = { ...queued("pinned", app, r1), pinnedToRunner: true, startRequested: true };
    const until = new Date("2099-01-01T00:00:00Z");
    const plan = planQueue({
      queued: [pinned],
      runners: [runner({ id: r1, usageLimits: [{ provider: "claude", until }] })],
      runs: [],
    });
    expect(plan.start).toEqual([{ runId: pinned.id, runnerId: r1 }]);
  });

  it("러너에 자리가 있으면 그 러너에서 시작한다", () => {
    const pinned = { ...queued("pinned", app, r1), pinnedToRunner: true };
    const plan = planQueue({
      queued: [pinned],
      runners: [runner({ id: r1 }), runner({ id: r2, capacity: 5 })],
      runs: [],
    });
    expect(plan.start).toEqual([{ runId: pinned.id, runnerId: r1 }]);
  });
});
