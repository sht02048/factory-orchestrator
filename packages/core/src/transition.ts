import type { RunState } from "./run.js";

/**
 * 스펙 4.1 상태 그림의 화살표. 여기 없는 전이는 거부한다.
 *
 * ```
 * Queued ──► Running ⇄ Waiting for Input
 * Running | Waiting for Input ──(러너에 5분 연속 닿지 않음)──► Disconnected
 * Disconnected ──(다시 연결)──► Running | Waiting for Input
 * Running | Waiting for Input | Disconnected ──► Ended
 * ```
 */
const NEXT_STATES: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  queued: new Set(["running"]),
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
