import { describe, expect, it } from "vitest";

import type { AgentActivity, UnreportedStop } from "./adapters.js";
import { TURN_ENDED_PAUSE_AFTER_MS, decideRunnerStop } from "./runner-stop.js";

const start = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);
const MINUTE = 60 * 1000;

function running(
  activity: AgentActivity,
  extra: { unreportedStop?: UnreportedStop | null; now?: Date; runningSince?: Date | null } = {},
) {
  return decideRunnerStop({
    state: "running",
    activity,
    unreportedStop: extra.unreportedStop ?? null,
    runningSince: extra.runningSince === undefined ? at(0) : extra.runningSince,
    pausedSince: null,
    now: extra.now ?? at(MINUTE),
  });
}

describe("decideRunnerStop(0120): Running 런", () => {
  it("러너에서 중단된 에이전트 세션은 '러너에서 멈춤'으로 Paused", () => {
    expect(running({ kind: "interrupted", since: at(30_000) })).toEqual({
      to: "paused",
      source: "runner",
      lastOutput: null,
    });
  });

  it("보고 없이 턴을 끝냈다는 러너 알림은 마지막 출력과 함께 '보고 없이 멈춤'으로 Paused", () => {
    expect(
      running(
        { kind: "turn-ended", since: at(30_000) },
        { unreportedStop: { at: at(30_000), lastOutput: ["커밋했어요", "❯"] } },
      ),
    ).toEqual({ to: "paused", source: "unreported", lastOutput: ["커밋했어요", "❯"] });
  });

  it("알림이 없어도 질문·보고 없이 끝난 턴이 오래 이어지면 '보고 없이 멈춤'", () => {
    const since = at(30_000);
    expect(
      running(
        { kind: "turn-ended", since },
        { now: new Date(since.getTime() + TURN_ENDED_PAUSE_AFTER_MS - 1) },
      ),
    ).toBeNull();
    expect(
      running(
        { kind: "turn-ended", since },
        { now: new Date(since.getTime() + TURN_ENDED_PAUSE_AFTER_MS) },
      ),
    ).toEqual({ to: "paused", source: "unreported", lastOutput: null });
  });

  it("에이전트가 일하는 중이면 지난 알림이 있어도 그대로 둔다", () => {
    expect(
      running(
        { kind: "working", since: at(40_000) },
        { unreportedStop: { at: at(30_000), lastOutput: [] } },
      ),
    ).toBeNull();
  });

  it("마지막으로 Running이 되기 전의 신호는 이미 지난 일이라 보지 않는다", () => {
    const runningSince = at(10 * MINUTE);
    expect(running({ kind: "interrupted", since: at(MINUTE) }, { runningSince })).toBeNull();
    expect(
      running(
        { kind: "turn-ended", since: at(MINUTE) },
        {
          runningSince,
          unreportedStop: { at: at(MINUTE), lastOutput: [] },
          now: at(60 * MINUTE),
        },
      ),
    ).toBeNull();
  });

  it("에이전트 상태를 모르면 Running 그대로 둔다", () => {
    expect(running({ kind: "unknown" })).toBeNull();
    expect(running({ kind: "interrupted", since: at(MINUTE) }, { runningSince: null })).toBeNull();
  });
});

describe("decideRunnerStop(0120): Paused 런", () => {
  const paused = (activity: AgentActivity) =>
    decideRunnerStop({
      state: "paused",
      activity,
      unreportedStop: { at: at(MINUTE), lastOutput: [] },
      runningSince: at(0),
      pausedSince: at(2 * MINUTE),
      now: at(10 * MINUTE),
    });

  it("러너에서 사람이 다시 일을 시작하면 Running으로 돌린다", () => {
    expect(paused({ kind: "working", since: at(3 * MINUTE) })).toEqual({ to: "running" });
  });

  it("멈추기 전부터 이어진 working 표시는 다시 시작한 것으로 보지 않는다", () => {
    expect(paused({ kind: "working", since: at(MINUTE) })).toBeNull();
  });

  it("다시 멈춘 신호나 모르는 상태는 Paused 그대로 둔다", () => {
    expect(paused({ kind: "interrupted", since: at(5 * MINUTE) })).toBeNull();
    expect(paused({ kind: "turn-ended", since: at(5 * MINUTE) })).toBeNull();
    expect(paused({ kind: "unknown" })).toBeNull();
  });
});
