import { describe, expect, it } from "vitest";

import { RUN_STATES } from "./run.js";
import type { RunState } from "./run.js";
import { canTransitionRun, transitionRun } from "./transition.js";

// 스펙 4.1 상태 그림의 화살표를 그대로 적은 것. 여기 없는 쌍은 모두 거부한다.
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

  it("Queued는 시작하지 않고 Ended가 되지 않는다", () => {
    expect(canTransitionRun("queued", "ended")).toBe(false);
  });

  it("Ended에서는 어디로도 가지 않는다", () => {
    for (const to of RUN_STATES) {
      expect(canTransitionRun("ended", to)).toBe(false);
    }
  });
});
