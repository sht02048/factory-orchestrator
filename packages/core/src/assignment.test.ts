import { describe, expect, it } from "vitest";

import {
  checkAssignment,
  checkAutoAssignment,
  checkManualRunnerChoice,
  checkMappingRepos,
  findLabelNamed,
  pickRunner,
  remainingCapacity,
  routeToRepo,
} from "./assignment.js";
import type { MappingRepo, RunnerSnapshot } from "./assignment.js";
import {
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
} from "./ids.js";
import { RUN_STATES } from "./run.js";
import type { AgentResult, RunState } from "./run.js";

const app = toRunnerProjectId("github:acme/app");
const web = toRunnerProjectId("github:acme/web");
const claude = toAgentId("claude");
const r1 = toRunnerId("r1");
const r2 = toRunnerId("r2");
const r3 = toRunnerId("r3");
const ticket = { connection: toTrackerConnectionId("c1"), key: toTicketKey("ENG-1") };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 9, minute));
const on = (state: RunState) => ({
  ticket,
  state,
  assignedAt: at(0),
  agentResult: state === "ended" ? ("reported-success" as const) : null,
  endedAt: state === "ended" ? at(1) : null,
});
const endedWith = (agentResult: AgentResult, assigned: number, ended: number) => ({
  ticket,
  state: "ended" as const,
  assignedAt: at(assigned),
  agentResult,
  endedAt: at(ended),
});

function runner(overrides: Partial<RunnerSnapshot> & Pick<RunnerSnapshot, "id">): RunnerSnapshot {
  return {
    online: true,
    assignmentBlocked: false,
    capacity: 2,
    projects: [app],
    usageLimits: [],
    ...overrides,
  };
}

describe("checkAutoAssignment", () => {
  const label = toLabelId("label-auto");

  it("Auto-assign Label이 있고 동시에 도는 런이 없으면 할당한다", () => {
    expect(
      checkAutoAssignment({
        labelIds: [label],
        autoAssignLabelId: label,
        labelAttachedAt: null,
        ticket,
        runs: [],
      }),
    ).toEqual({ ok: true });
  });

  it("Auto-assign Label이 없으면 할당하지 않는다", () => {
    expect(
      checkAutoAssignment({
        labelIds: [toLabelId("other")],
        autoAssignLabelId: label,
        labelAttachedAt: null,
        ticket,
        runs: [],
      }),
    ).toEqual({ ok: false, reason: "no-auto-assign-label" });
  });

  it.each(RUN_STATES)("티켓에 %s 런이 있을 때 할당 여부", (state) => {
    const expected = state === "ended" ? { ok: true } : { ok: false, reason: "active-run" };

    expect(
      checkAutoAssignment({
        labelIds: [label],
        autoAssignLabelId: label,
        labelAttachedAt: null,
        ticket,
        runs: [on(state)],
      }),
    ).toEqual(expected);
  });

  it("Disconnected 런이 있는 티켓은 할당하지 않는다 (Q74)", () => {
    expect(
      checkAutoAssignment({
        labelIds: [label],
        autoAssignLabelId: label,
        labelAttachedAt: null,
        ticket,
        runs: [on("ended"), on("disconnected")],
      }),
    ).toEqual({ ok: false, reason: "active-run" });
  });
});

describe("운영자가 취소한 티켓 (Q82.12)", () => {
  const label = toLabelId("label-auto");
  const check = (labelAttachedAt: Date | null, runs: ReturnType<typeof endedWith>[]) =>
    checkAutoAssignment({
      labelIds: [label],
      autoAssignLabelId: label,
      labelAttachedAt,
      ticket,
      runs,
    });

  it("마지막 런을 취소한 티켓은 라벨이 남아 있어도 자동 할당하지 않는다", () => {
    expect(check(at(5), [endedWith("canceled", 10, 20)])).toEqual({
      ok: false,
      reason: "canceled-by-operator",
    });
  });

  it("라벨이 언제 붙었는지 모르면(폴링 보정) 다시 붙었다는 증거가 없어 할당하지 않는다", () => {
    expect(check(null, [endedWith("canceled", 10, 20)])).toEqual({
      ok: false,
      reason: "canceled-by-operator",
    });
  });

  it("취소 뒤 라벨이 다시 붙으면 할당한다", () => {
    expect(check(at(30), [endedWith("canceled", 10, 20)])).toEqual({ ok: true });
  });

  it("취소 뒤 수동 할당한 런이 끝났으면 마지막 런이 취소가 아니라 다시 자동 할당 대상이다", () => {
    expect(
      check(at(5), [endedWith("canceled", 10, 20), endedWith("reported-success", 30, 40)]),
    ).toEqual({ ok: true });
  });

  it("다른 결과로 끝난 런은 이 규칙에 걸리지 않는다", () => {
    expect(check(null, [endedWith("timed-out", 10, 20)])).toEqual({ ok: true });
  });

  it("수동 할당은 취소한 티켓도 막지 않는다", () => {
    expect(checkAssignment({ ticket, runs: [endedWith("canceled", 10, 20)] })).toEqual({
      ok: true,
    });
  });
});

describe("checkAssignment", () => {
  it("수동 할당은 라벨 없이 티켓당 런 하나 규칙만 본다", () => {
    expect(checkAssignment({ ticket, runs: [on("ended")] })).toEqual({ ok: true });
    expect(checkAssignment({ ticket, runs: [on("queued")] })).toEqual({
      ok: false,
      reason: "active-run",
    });
  });
});

describe("티켓 구분", () => {
  it("다른 트래커 연결의 같은 티켓 키는 다른 티켓이라 할당을 막지 않는다", () => {
    const other = { connection: toTrackerConnectionId("c2"), key: ticket.key };

    expect(checkAssignment({ ticket, runs: [{ ticket: other, state: "running" }] })).toEqual({
      ok: true,
    });
  });
});

describe("remainingCapacity", () => {
  it("Running·Waiting for Input·Disconnected 런이 capacity를 차지하고 Queued·Ended는 차지하지 않는다 (Q74)", () => {
    const states: RunState[] = ["queued", "running", "waiting-for-input", "disconnected", "ended"];
    const runs = states.map((state) => ({ runnerId: r1, state }));

    expect(remainingCapacity(runner({ id: r1, capacity: 5 }), runs)).toBe(2);
  });

  it("다른 러너의 런은 세지 않는다", () => {
    expect(
      remainingCapacity(runner({ id: r1, capacity: 1 }), [{ runnerId: r2, state: "running" }]),
    ).toBe(1);
  });
});

describe("pickRunner", () => {
  it("러너 쪽 프로젝트가 있는 Online 러너 중 남은 capacity가 가장 많은 러너를 고른다 (Q53)", () => {
    const runners = [
      runner({ id: r1, capacity: 2 }),
      runner({ id: r2, capacity: 3 }),
      runner({ id: r3, capacity: 9, projects: [web] }),
    ];
    const runs = [{ runnerId: r2, state: "running" as const }];

    expect(pickRunner({ project: app, agent: claude, runners, runs })).toBe(r1);
    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBe(r2);
  });

  it("Offline 러너는 남은 capacity가 많아도 고르지 않는다", () => {
    const runners = [
      runner({ id: r1, capacity: 9, online: false }),
      runner({ id: r2, capacity: 1 }),
    ];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBe(r2);
  });

  it("남은 capacity가 없어도 맞는 Online 러너가 있으면 고른다(대기열에서 기다린다)", () => {
    const runners = [runner({ id: r1, capacity: 1 })];

    expect(
      pickRunner({
        project: app,
        agent: claude,
        runners,
        runs: [{ runnerId: r1, state: "running" }],
      }),
    ).toBe(r1);
  });

  it("GitHub 인증이 깨진 러너는 남은 capacity가 많아도 고르지 않는다 (Q82.14)", () => {
    const runners = [
      runner({ id: r1, capacity: 9, assignmentBlocked: true }),
      runner({ id: r2, capacity: 1 }),
    ];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBe(r2);
  });

  it("맞는 러너가 모두 인증이 깨졌으면 러너를 정하지 않는다 (Q87)", () => {
    const runners = [runner({ id: r1, assignmentBlocked: true })];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBeNull();
  });

  it("런의 에이전트가 쓰는 공급자 한도에 닿은 러너는 남은 capacity가 많아도 고르지 않는다", () => {
    const limited = [{ provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 10)) }];
    const runners = [runner({ id: r1, capacity: 9, usageLimits: limited }), runner({ id: r2 })];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBe(r2);
    expect(pickRunner({ project: app, agent: toAgentId("codex"), runners, runs: [] })).toBe(r1);
  });

  it("맞는 러너가 모두 한도에 닿았으면 러너를 정하지 않는다", () => {
    const limited = [{ provider: "claude", until: new Date(Date.UTC(2026, 10, 19, 10)) }];
    const runners = [runner({ id: r1, usageLimits: limited })];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBeNull();
  });

  it("맞는 러너가 모두 Offline이면 러너를 정하지 않는다 (Q65)", () => {
    const runners = [runner({ id: r1, online: false }), runner({ id: r2, projects: [web] })];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBeNull();
  });
});

describe("checkManualRunnerChoice", () => {
  it("수동 할당에서 인증이 깨진 러너는 고를 수 없고, Offline 러너는 고를 수 있다 (Q87)", () => {
    expect(checkManualRunnerChoice(runner({ id: r1, assignmentBlocked: true }), app)).toEqual({
      ok: false,
      reason: "assignment-blocked",
    });
    expect(checkManualRunnerChoice(runner({ id: r2, online: false }), app)).toEqual({ ok: true });
  });

  it("push가 깨진 프로젝트의 런만 그 러너에 수동으로 맡길 수 없다 (0096)", () => {
    const pushBroken = runner({ id: r1, projects: [app, web], blockedProjects: [app] });

    expect(checkManualRunnerChoice(pushBroken, app)).toEqual({
      ok: false,
      reason: "assignment-blocked",
    });
    expect(checkManualRunnerChoice(pushBroken, web)).toEqual({ ok: true });
  });
});

describe("push가 깨진 프로젝트 (0096)", () => {
  it("그 프로젝트의 티켓만 그 러너에 맡기지 않고 다른 프로젝트 티켓은 맡긴다", () => {
    const runners = [
      runner({ id: r1, capacity: 9, projects: [app, web], blockedProjects: [app] }),
      runner({ id: r2, capacity: 1 }),
    ];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBe(r2);
    expect(pickRunner({ project: web, agent: claude, runners, runs: [] })).toBe(r1);
  });

  it("맞는 러너가 모두 그 프로젝트의 push가 깨졌으면 러너를 정하지 않는다", () => {
    const runners = [runner({ id: r1, blockedProjects: [app] })];

    expect(pickRunner({ project: app, agent: claude, runners, runs: [] })).toBeNull();
  });
});

describe("routeToRepo (0115)", () => {
  const api = toRunnerProjectId("github:acme/api");
  const apiLabel = toLabelId("label-api");
  const webLabel = toLabelId("label-web");
  const bug = toLabelId("label-bug");
  const repos: MappingRepo[] = [
    { project: app, isDefault: true, labelId: null },
    { project: api, isDefault: false, labelId: apiLabel },
    { project: web, isDefault: false, labelId: webLabel },
  ];

  it("저장소에 붙인 라벨이 티켓에 정확히 하나 있으면 그 저장소로 간다", () => {
    expect(routeToRepo(repos, [bug, apiLabel])).toBe(api);
  });

  it("맞는 라벨이 없으면 기본 저장소로 간다", () => {
    expect(routeToRepo(repos, [bug])).toBe(app);
    expect(routeToRepo(repos, [])).toBe(app);
  });

  it("저장소 라벨이 둘 이상 맞으면 어느 쪽인지 모르니 기본 저장소로 간다", () => {
    expect(routeToRepo(repos, [apiLabel, webLabel])).toBe(app);
  });

  it("라벨 없는 저장소가 하나뿐이면 그것이 기본이다", () => {
    expect(routeToRepo([{ project: app, isDefault: true, labelId: null }], [apiLabel])).toBe(app);
  });

  it("저장소가 없으면 갈 곳이 없다", () => {
    expect(routeToRepo([], [apiLabel])).toBeNull();
  });
});

describe("checkMappingRepos (0115)", () => {
  const label = toLabelId("label-api");
  const repo = (
    project: string,
    isDefault: boolean,
    labelId: string | null = null,
  ): MappingRepo => ({
    project: toRunnerProjectId(project),
    isDefault,
    labelId: labelId === null ? null : toLabelId(labelId),
  });

  it("기본 하나와 서로 다른 라벨이면 받는다", () => {
    expect(checkMappingRepos([repo("a", true), repo("b", false, "x"), repo("c", false)])).toEqual({
      ok: true,
    });
  });

  it("같은 트래커 프로젝트에서 한 라벨을 두 저장소에 붙이면 거절한다", () => {
    expect(
      checkMappingRepos([repo("a", true), repo("b", false, label), repo("c", false, label)]),
    ).toEqual({ ok: false, reason: "label-in-use" });
  });

  it("기본이 없거나 둘이면 거절한다", () => {
    expect(checkMappingRepos([repo("a", false)])).toEqual({ ok: false, reason: "no-default" });
    expect(checkMappingRepos([repo("a", true), repo("b", true)])).toEqual({
      ok: false,
      reason: "many-defaults",
    });
  });

  it("기본 저장소에는 라벨을 붙이지 않는다", () => {
    expect(checkMappingRepos([repo("a", true, "x")])).toEqual({
      ok: false,
      reason: "default-has-label",
    });
  });

  it("같은 저장소를 두 번 넣거나 저장소가 없으면 거절한다", () => {
    expect(checkMappingRepos([repo("a", true), repo("a", false)])).toEqual({
      ok: false,
      reason: "duplicate-repo",
    });
    expect(checkMappingRepos([])).toEqual({ ok: false, reason: "no-repos" });
  });
});

describe("findLabelNamed (0115)", () => {
  it("이름의 대소문자와 앞뒤 빈칸을 가리지 않고 찾는다", () => {
    const labels = [
      { id: "1", name: "bug" },
      { id: "2", name: " Ganger " },
    ];
    expect(findLabelNamed(labels, "ganger")?.id).toBe("2");
    expect(findLabelNamed(labels, "infra")).toBeNull();
  });
});
