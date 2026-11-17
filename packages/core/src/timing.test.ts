import { describe, expect, it } from "vitest";

import {
  DISCONNECT_AFTER_MS,
  decideConnection,
  decideTimeout,
  resolveRunProgress,
  runDurations,
} from "./timing.js";

const start = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const SECOND = 1000;

describe("decideTimeout", () => {
  const maxRunMs = 2 * HOUR;

  it.each([
    ["running", { agentResult: "timed-out", stopAgent: true }],
    ["waiting-for-input", { agentResult: "stopped-waiting-for-input", stopAgent: true }],
    ["disconnected", { agentResult: "runner-disconnected", stopAgent: false }],
  ] as const)(
    "%s 상태에서 최대 실행 시간이 지나면 멈출 때의 상태로 에이전트 결과를 가른다 (Q39·Q52·Q67·Q70)",
    (state, expected) => {
      expect(decideTimeout({ state, startedAt: start, now: at(maxRunMs), maxRunMs })).toEqual(
        expected,
      );
    },
  );

  it("최대 실행 시간 전이면 끝내지 않는다", () => {
    expect(
      decideTimeout({ state: "running", startedAt: start, now: at(maxRunMs - 1), maxRunMs }),
    ).toBeNull();
  });

  it.each(["queued", "ended"] as const)("%s 런은 시간 초과를 보지 않는다", (state) => {
    expect(decideTimeout({ state, startedAt: start, now: at(10 * maxRunMs), maxRunMs })).toBeNull();
  });
});

describe("decideConnection", () => {
  it("ssh가 4분 59초 동안 실패했으면 이어서 본다 (Q50)", () => {
    expect(
      decideConnection({
        state: "running",
        sshFailingSince: start,
        now: at(4 * MINUTE + 59 * SECOND),
      }),
    ).toBe("keep-watching");
  });

  it.each(["running", "waiting-for-input"] as const)(
    "%s 런은 ssh가 5분 동안 계속 실패하면 Disconnected가 된다 (Q67)",
    (state) => {
      expect(
        decideConnection({ state, sshFailingSince: start, now: at(DISCONNECT_AFTER_MS) }),
      ).toBe("disconnect");
      expect(DISCONNECT_AFTER_MS).toBe(5 * MINUTE);
    },
  );

  it("ssh가 실패하고 있지 않으면 이어서 본다", () => {
    expect(decideConnection({ state: "running", sshFailingSince: null, now: at(HOUR) })).toBe(
      "keep-watching",
    );
  });

  it.each(["queued", "disconnected", "ended"] as const)(
    "%s 런은 연결 끊김으로 바꾸지 않는다",
    (state) => {
      expect(decideConnection({ state, sshFailingSince: start, now: at(HOUR) })).toBe(
        "keep-watching",
      );
    },
  );
});

describe("resolveRunProgress", () => {
  it("다시 연결했을 때 에이전트가 돌고 있으면 Running으로 돌아간다", () => {
    expect(resolveRunProgress({ kind: "running", agentStates: [], lastOutputAt: null })).toEqual({
      kind: "continue",
      state: "running",
    });
  });

  it("다시 연결했을 때 입력을 기다리고 있으면 바로 Waiting for Input으로 돌아간다 (Q67)", () => {
    expect(resolveRunProgress({ kind: "waiting-for-input", detail: "권한 프롬프트" })).toEqual({
      kind: "continue",
      state: "waiting-for-input",
    });
  });

  it.each([
    [0, "exited-normally"],
    [1, "exited-with-error"],
    [137, "exited-with-error"],
    [null, "exited-with-error"],
  ] as const)(
    "다시 연결했을 때 에이전트가 종료 코드 %s 로 끝났으면 %s 로 끝낸다",
    (exitCode, agentResult) => {
      expect(resolveRunProgress({ kind: "finished", exitCode })).toEqual({
        kind: "end",
        agentResult,
      });
    },
  );

  it("다시 연결했을 때 워크트리가 사라졌으면 워크트리 없음으로 끝낸다 (Q49·Q67)", () => {
    expect(resolveRunProgress({ kind: "gone" })).toEqual({
      kind: "end",
      agentResult: "worktree-missing",
    });
  });
});

describe("runDurations", () => {
  it("리드 타임은 할당부터 종료까지이고 대기 시간과 실행 시간으로 나뉜다 (Q59)", () => {
    expect(
      runDurations({
        assignedAt: start,
        startedAt: at(10 * MINUTE),
        endedAt: at(70 * MINUTE),
      }),
    ).toEqual({ leadTimeMs: 70 * MINUTE, waitMs: 10 * MINUTE, executionMs: 60 * MINUTE });
  });

  it("아직 시작하지 않은 런은 대기 시간만 지금까지로 센다", () => {
    expect(
      runDurations({ assignedAt: start, startedAt: null, endedAt: null, now: at(5 * MINUTE) }),
    ).toEqual({ leadTimeMs: null, waitMs: 5 * MINUTE, executionMs: null });
  });

  it("끝나지 않은 런은 리드 타임이 없고 실행 시간은 지금까지로 센다", () => {
    expect(
      runDurations({
        assignedAt: start,
        startedAt: at(MINUTE),
        endedAt: null,
        now: at(3 * MINUTE),
      }),
    ).toEqual({ leadTimeMs: null, waitMs: MINUTE, executionMs: 2 * MINUTE });
  });

  it("now 없이 끝나지 않은 런은 진행 중인 구간을 세지 않는다", () => {
    expect(runDurations({ assignedAt: start, startedAt: at(MINUTE), endedAt: null })).toEqual({
      leadTimeMs: null,
      waitMs: MINUTE,
      executionMs: null,
    });
  });
});
