import { describe, expect, it } from "vitest";

import { toPermissionRequestId, toQuestionId } from "./ids.js";
import type { PermissionRequestId, QuestionId } from "./ids.js";
import {
  DISCONNECT_AFTER_MS,
  MAX_START_RETRIES,
  decideConnection,
  decideStartFailure,
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

  const base = { startedAt: start, maxRunMs, cancelRequested: false };

  it.each([
    ["running", { agentResult: "timed-out", stopAgent: true, runnerUnreached: false }],
    [
      "waiting-for-input",
      { agentResult: "stopped-waiting-for-input", stopAgent: true, runnerUnreached: false },
    ],
    [
      "disconnected",
      { agentResult: "runner-disconnected", stopAgent: false, runnerUnreached: false },
    ],
  ] as const)(
    "%s 상태에서 최대 실행 시간이 지나면 멈출 때의 상태로 에이전트 결과를 가른다 (Q39·Q52·Q67·Q70)",
    (state, expected) => {
      expect(decideTimeout({ ...base, state, now: at(maxRunMs) })).toEqual(expected);
    },
  );

  it.each([
    ["running", { agentResult: "canceled", stopAgent: true, runnerUnreached: false }],
    ["waiting-for-input", { agentResult: "canceled", stopAgent: true, runnerUnreached: false }],
    ["disconnected", { agentResult: "canceled", stopAgent: false, runnerUnreached: true }],
  ] as const)(
    "취소 중인 %s 런의 최대 실행 시간이 지나면 운영자가 취소함으로 끝낸다 (Q82.11·Q82.21)",
    (state, expected) => {
      expect(decideTimeout({ ...base, cancelRequested: true, state, now: at(maxRunMs) })).toEqual(
        expected,
      );
    },
  );

  it("최대 실행 시간 전이면 끝내지 않는다", () => {
    expect(decideTimeout({ ...base, state: "running", now: at(maxRunMs - 1) })).toBeNull();
  });

  it.each(["queued", "ended"] as const)("%s 런은 시간 초과를 보지 않는다", (state) => {
    expect(decideTimeout({ ...base, state, now: at(10 * maxRunMs) })).toBeNull();
  });
});

describe("decideConnection", () => {
  it("ssh가 4분 59초 동안 실패했으면 이어서 본다 (Q50)", () => {
    expect(
      decideConnection({
        state: "running",
        unreachableSince: start,
        now: at(4 * MINUTE + 59 * SECOND),
      }),
    ).toBe("keep-watching");
  });

  it.each(["running", "waiting-for-input"] as const)(
    "%s 런은 ssh가 5분 동안 계속 실패하면 Disconnected가 된다 (Q67)",
    (state) => {
      expect(
        decideConnection({ state, unreachableSince: start, now: at(DISCONNECT_AFTER_MS) }),
      ).toBe("disconnect");
      expect(DISCONNECT_AFTER_MS).toBe(5 * MINUTE);
    },
  );

  it("ssh가 실패하고 있지 않으면 이어서 본다", () => {
    expect(decideConnection({ state: "running", unreachableSince: null, now: at(HOUR) })).toBe(
      "keep-watching",
    );
  });

  it.each(["queued", "disconnected", "ended"] as const)(
    "%s 런은 연결 끊김으로 바꾸지 않는다",
    (state) => {
      expect(decideConnection({ state, unreachableSince: start, now: at(HOUR) })).toBe(
        "keep-watching",
      );
    },
  );
});

describe("resolveRunProgress", () => {
  const q1 = toQuestionId("q1");
  const q2 = toQuestionId("q2");
  const p1 = toPermissionRequestId("p1");
  const nothingHandled = {
    answered: new Set<QuestionId>(),
    denied: new Set<PermissionRequestId>(),
  };
  const question = (id: QuestionId) => ({
    id,
    body: "A와 B 중 무엇?",
    options: ["A", "B"],
    askedAt: start,
  });
  const active = (questions: QuestionId[], permissions: PermissionRequestId[]) =>
    ({
      kind: "active",
      questions: questions.map(question),
      permissionWaits: permissions.map((id) => ({ id, detail: "touch", requestedAt: start })),
    }) as const;

  it("에이전트가 돌고 있고 기다리는 입력이 없으면 Running이다", () => {
    expect(resolveRunProgress(active([], []), nothingHandled)).toEqual({
      kind: "continue",
      state: "running",
    });
  });

  it("답하지 않은 질문이 있으면 Waiting for Input이다 (Q82.3·Q67)", () => {
    expect(resolveRunProgress(active([q1], []), nothingHandled)).toEqual({
      kind: "continue",
      state: "waiting-for-input",
      questions: [q1],
      permissionWaits: [],
    });
  });

  it("러너는 답한 질문도 다시 돌려주므로 DB에 답했다고 기록한 질문은 거른다 (Q82.5)", () => {
    const handled = { ...nothingHandled, answered: new Set([q1]) };

    expect(resolveRunProgress(active([q1], []), handled)).toEqual({
      kind: "continue",
      state: "running",
    });
    expect(resolveRunProgress(active([q1, q2], []), handled)).toMatchObject({
      state: "waiting-for-input",
      questions: [q2],
    });
  });

  it("권한 대기는 질문과 따로 Waiting for Input으로 돌려주고, 거절한 대기는 거른다 (Q82.4)", () => {
    expect(resolveRunProgress(active([], [p1]), nothingHandled)).toEqual({
      kind: "continue",
      state: "waiting-for-input",
      questions: [],
      permissionWaits: [p1],
    });
    expect(
      resolveRunProgress(active([], [p1]), { ...nothingHandled, denied: new Set([p1]) }),
    ).toEqual({ kind: "continue", state: "running" });
  });

  it.each([
    ["succeeded", "reported-success"],
    ["failed", "reported-failure"],
    ["something-new", "reported-failure"],
  ] as const)(
    "완료 보고 outcome %s 는 %s 로 끝내고 보고를 함께 준다 (Q82.2)",
    (outcome, agentResult) => {
      const report = { outcome, body: "PR을 열었어요", reportedAt: null };

      expect(resolveRunProgress({ kind: "reported", report }, nothingHandled)).toEqual({
        kind: "end",
        agentResult,
        report,
      });
    },
  );

  it("보고 없이 사라졌으면 비정상 종료로 끝낸다 (Q82.19)", () => {
    expect(
      resolveRunProgress({ kind: "ended-without-report", detail: "lost" }, nothingHandled),
    ).toEqual({ kind: "end", agentResult: "ended-without-report", report: null });
  });

  it("워크트리가 사라졌으면 워크트리 없음으로 끝낸다 (Q49·Q67)", () => {
    expect(resolveRunProgress({ kind: "worktree-gone" }, nothingHandled)).toEqual({
      kind: "end",
      agentResult: "worktree-missing",
      report: null,
    });
  });
});

describe("decideStartFailure (Q86)", () => {
  it("러너에 닿지 못하면 Offline 예외처럼 순서에서 빼고 시도 횟수에 넣지 않는다", () => {
    expect(decideStartFailure({ kind: "unreachable", detail: "ssh" }, 2)).toEqual({
      action: "wait-like-offline",
    });
  });

  it("결과를 모르면 같은 이름으로 이미 시작했는지 찾은 뒤에만 다시 보낸다", () => {
    expect(decideStartFailure({ kind: "start-outcome-unknown", detail: "lost" }, 0)).toEqual({
      action: "find-then-retry",
    });
  });

  it("읽을 수 없는 출력은 러너 오류처럼 세어 대기열이 끝없이 막히지 않는다", () => {
    expect(decideStartFailure({ kind: "malformed-output", raw: "?" }, 3)).toEqual({
      action: "could-not-start",
      failures: 4,
    });
  });

  it("우편함이 사라졌으면 다시 만든 뒤 보낸다", () => {
    expect(decideStartFailure({ kind: "mailbox-missing", detail: "gone" }, 0)).toEqual({
      action: "recreate-mailbox",
    });
  });

  it("러너가 오류를 내면 같은 이름으로 3번까지 다시 시도하고, 그래도 안 되면 시작할 수 없음이다", () => {
    const error = { kind: "runner-error", code: "boom", message: "boom" } as const;
    expect(MAX_START_RETRIES).toBe(3);

    expect(decideStartFailure(error, 0)).toEqual({ action: "retry", failures: 1 });
    expect(decideStartFailure(error, 2)).toEqual({ action: "retry", failures: 3 });
    expect(decideStartFailure(error, 3)).toEqual({ action: "could-not-start", failures: 4 });
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

  it.each([
    ["Queued에서 취소", 7 * MINUTE],
    ["시작할 수 없음", 0],
  ])(
    "시작하지 않고 끝난 런(%s)은 대기 시간이 할당부터 끝낸 시각까지이고 실행 시간은 0이다 (Q82.9·Q82.20)",
    (_case, waited) => {
      expect(
        runDurations({
          assignedAt: start,
          startedAt: null,
          endedAt: at(waited),
          now: at(HOUR),
        }),
      ).toEqual({ leadTimeMs: waited, waitMs: waited, executionMs: 0 });
    },
  );
});
