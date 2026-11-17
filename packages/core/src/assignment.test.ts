import { describe, expect, it } from "vitest";

import {
  checkAssignment,
  checkAutoAssignment,
  pickRunner,
  remainingCapacity,
} from "./assignment.js";
import type { RunnerSnapshot } from "./assignment.js";
import { toLabelId, toRunnerId, toRunnerProjectId } from "./ids.js";
import { RUN_STATES } from "./run.js";
import type { RunState } from "./run.js";

const app = toRunnerProjectId("github:acme/app");
const web = toRunnerProjectId("github:acme/web");
const r1 = toRunnerId("r1");
const r2 = toRunnerId("r2");
const r3 = toRunnerId("r3");

function runner(overrides: Partial<RunnerSnapshot> & Pick<RunnerSnapshot, "id">): RunnerSnapshot {
  return { online: true, capacity: 2, projects: [app], ...overrides };
}

describe("checkAutoAssignment", () => {
  const label = toLabelId("label-auto");

  it("Auto-assign Label이 있고 동시에 도는 런이 없으면 할당한다", () => {
    expect(
      checkAutoAssignment({ labelIds: [label], autoAssignLabelId: label, runsForTicket: [] }),
    ).toEqual({ ok: true });
  });

  it("Auto-assign Label이 없으면 할당하지 않는다", () => {
    expect(
      checkAutoAssignment({
        labelIds: [toLabelId("other")],
        autoAssignLabelId: label,
        runsForTicket: [],
      }),
    ).toEqual({ ok: false, reason: "no-auto-assign-label" });
  });

  it.each(RUN_STATES)("티켓에 %s 런이 있을 때 할당 여부", (state) => {
    const expected = state === "ended" ? { ok: true } : { ok: false, reason: "active-run" };

    expect(
      checkAutoAssignment({
        labelIds: [label],
        autoAssignLabelId: label,
        runsForTicket: [{ state }],
      }),
    ).toEqual(expected);
  });

  it("Disconnected 런이 있는 티켓은 할당하지 않는다 (Q74)", () => {
    expect(
      checkAutoAssignment({
        labelIds: [label],
        autoAssignLabelId: label,
        runsForTicket: [{ state: "ended" }, { state: "disconnected" }],
      }),
    ).toEqual({ ok: false, reason: "active-run" });
  });
});

describe("checkAssignment", () => {
  it("수동 할당은 라벨 없이 티켓당 런 하나 규칙만 본다", () => {
    expect(checkAssignment({ runsForTicket: [{ state: "ended" }] })).toEqual({ ok: true });
    expect(checkAssignment({ runsForTicket: [{ state: "queued" }] })).toEqual({
      ok: false,
      reason: "active-run",
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

    // r1 남은 2, r2 남은 2, r3은 프로젝트가 없다. 같으면 앞에 둔 러너를 고른다.
    expect(pickRunner({ project: app, runners, runs })).toBe(r1);
    expect(pickRunner({ project: app, runners, runs: [] })).toBe(r2);
  });

  it("Offline 러너는 남은 capacity가 많아도 고르지 않는다", () => {
    const runners = [
      runner({ id: r1, capacity: 9, online: false }),
      runner({ id: r2, capacity: 1 }),
    ];

    expect(pickRunner({ project: app, runners, runs: [] })).toBe(r2);
  });

  it("남은 capacity가 없어도 맞는 Online 러너가 있으면 고른다(대기열에서 기다린다)", () => {
    const runners = [runner({ id: r1, capacity: 1 })];

    expect(pickRunner({ project: app, runners, runs: [{ runnerId: r1, state: "running" }] })).toBe(
      r1,
    );
  });

  it("맞는 러너가 모두 Offline이면 러너를 정하지 않는다 (Q65)", () => {
    const runners = [runner({ id: r1, online: false }), runner({ id: r2, projects: [web] })];

    expect(pickRunner({ project: app, runners, runs: [] })).toBeNull();
  });
});
