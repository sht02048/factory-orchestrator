import type { RunState } from "./run.js";

/**
 * 스펙 4.1 상태 그림의 화살표. 여기 없는 전이는 거부한다.
 *
 * ```
 * Queued ──► Running ⇄ Waiting for Input
 * Running | Waiting for Input ──(러너에 5분 연속 닿지 않음)──► Disconnected
 * Disconnected ──(다시 연결)──► Running | Waiting for Input
 * Running | Waiting for Input | Disconnected ──► Ended
 * Queued ──(운영자 취소, 시작할 수 없음)──► Ended
 * ```
 */
const NEXT_STATES: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  queued: new Set(["running", "ended"]),
  running: new Set(["waiting-for-input", "disconnected", "ended"]),
  "waiting-for-input": new Set(["running", "disconnected", "ended"]),
  disconnected: new Set(["running", "waiting-for-input", "ended"]),
  ended: new Set(),
};

export interface InvalidRunTransition {
  kind: "invalid-transition";
  from: RunState;
  to: RunState;
}

export type RunTransitionResult =
  | { ok: true; state: RunState }
  | { ok: false; error: InvalidRunTransition };

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return NEXT_STATES[from].has(to);
}

/** 런 상태를 바꿀 때 반드시 거친다. 허용하지 않는 전이는 오류로 돌려준다. */
export function transitionRun(from: RunState, to: RunState): RunTransitionResult {
  if (!canTransitionRun(from, to)) {
    return { ok: false, error: { kind: "invalid-transition", from, to } };
  }
  return { ok: true, state: to };
}

/**
 * 런 취소를 어떻게 할지(스펙 3절 6번, Q77·Q82.8~Q82.11·Q82.21).
 * - end-now: Queued. 바로 끝내고 PR을 찾지 않아 PR 상태는 없음이다(Q82.10).
 * - stop-agent-then-end: Running·Waiting for Input. 에이전트를 멈춘 뒤 끝내고 PR 상태를 함께 기록한다.
 *   멈추기가 실패하면 상태를 그대로 두고(취소 중) 다시 시도한다(Q82.11).
 * - wait-for-reconnect: Disconnected. 다시 닿으면 멈추고 끝낸다. 닿지 않은 채 최대 실행 시간이 지나면
 *   러너에 닿지 못한 채 운영자가 취소함으로 끝낸다(decideTimeout, Q82.21).
 *
 * 요청을 받을 때와 처리할 때 모두 부른다. 처리하기 전에 상태가 바뀌었으면 그 상태의 규칙으로 취소하고,
 * 이미 Ended면 거부한다(처리하지 않는다).
 */
export type CancelPlan =
  | { ok: true; action: "end-now" | "stop-agent-then-end" | "wait-for-reconnect" }
  | { ok: false; reason: "already-ended" };

export function planCancel(state: RunState): CancelPlan {
  switch (state) {
    case "queued":
      return { ok: true, action: "end-now" };
    case "running":
    case "waiting-for-input":
      return { ok: true, action: "stop-agent-then-end" };
    case "disconnected":
      return { ok: true, action: "wait-for-reconnect" };
    case "ended":
      return { ok: false, reason: "already-ended" };
  }
}
