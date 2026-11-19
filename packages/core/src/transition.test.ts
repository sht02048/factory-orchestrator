import { describe, expect, it } from "vitest";

import { RUN_STATES } from "./run.js";
import type { RunState } from "./run.js";
import { canTransitionRun, planCancel, planRunControl, transitionRun } from "./transition.js";

const ALLOWED: ReadonlyArray<readonly [RunState, RunState]> = [
  ["queued", "running"],
  ["running", "waiting-for-input"],
  ["waiting-for-input", "running"],
  ["running", "disconnected"],
  ["waiting-for-input", "disconnected"],
  ["disconnected", "running"],
  ["disconnected", "waiting-for-input"],
  ["running", "ended"],
  ["waiting-for-input", "ended"],
  ["disconnected", "ended"],
  ["queued", "ended"],
  ["running", "paused"],
  ["paused", "running"],
  ["paused", "disconnected"],
  ["paused", "ended"],
  ["disconnected", "paused"],
];

const isAllowed = (from: RunState, to: RunState): boolean =>
  ALLOWED.some(([f, t]) => f === from && t === to);

const ALL_PAIRS = RUN_STATES.flatMap((from) => RUN_STATES.map((to) => [from, to] as const));

describe("transitionRun", () => {
  it.each(ALL_PAIRS)("%s → %s 는 상태 그림대로 허용하거나 거부한다", (from, to) => {
    const expected = isAllowed(from, to)
      ? { ok: true, state: to }
      : { ok: false, error: { kind: "invalid-transition", from, to } };

    expect(transitionRun(from, to)).toEqual(expected);
    expect(canTransitionRun(from, to)).toBe(isAllowed(from, to));
  });

  it("다시 연결했을 때 입력을 기다리고 있으면 Disconnected에서 바로 Waiting for Input으로 간다 (Q67)", () => {
    expect(transitionRun("disconnected", "waiting-for-input")).toEqual({
      ok: true,
      state: "waiting-for-input",
    });
  });

  it("Ended가 아닌 모든 상태에서 Ended로 갈 수 있다(취소, Q82.8)", () => {
    for (const from of RUN_STATES.filter((state) => state !== "ended")) {
      expect(canTransitionRun(from, "ended")).toBe(true);
    }
  });

  it("Ended에서는 어디로도 가지 않는다", () => {
    for (const to of RUN_STATES) {
      expect(canTransitionRun("ended", to)).toBe(false);
    }
  });
});

describe("planCancel", () => {
  it.each([
    ["queued", "end-now"],
    ["running", "stop-agent-then-end"],
    ["waiting-for-input", "stop-agent-then-end"],
    ["paused", "stop-agent-then-end"],
    ["disconnected", "wait-for-reconnect"],
  ] as const)("%s 런의 취소는 받아들인다: %s (Q82.8·Q82.10·Q82.11)", (state, action) => {
    expect(planCancel(state)).toEqual({ ok: true, action });
  });

  it("Ended 런의 취소는 거부한다 (Q82.8)", () => {
    expect(planCancel("ended")).toEqual({ ok: false, reason: "already-ended" });
  });
});

describe("planRunControl(0118)", () => {
  it("Running 런만 멈추고, Paused 런만 재개한다", () => {
    expect(planRunControl("running", "pause")).toEqual({ ok: true });
    expect(planRunControl("paused", "resume")).toEqual({ ok: true });
    for (const state of ["queued", "waiting-for-input", "paused", "disconnected"] as const) {
      expect(planRunControl(state, "pause")).toEqual({ ok: false, reason: "not-running" });
    }
    for (const state of ["queued", "running", "waiting-for-input", "disconnected"] as const) {
      expect(planRunControl(state, "resume")).toEqual({ ok: false, reason: "not-paused" });
    }
  });

  it("Ended 런은 멈추거나 재개하지 않는다", () => {
    expect(planRunControl("ended", "pause")).toEqual({ ok: false, reason: "already-ended" });
    expect(planRunControl("ended", "resume")).toEqual({ ok: false, reason: "already-ended" });
  });

  it("다시 연결했을 때 운영자가 멈춰 둔 런이면 Disconnected에서 Paused로 돌아간다", () => {
    expect(canTransitionRun("disconnected", "paused")).toBe(true);
    expect(canTransitionRun("waiting-for-input", "paused")).toBe(false);
  });
});
