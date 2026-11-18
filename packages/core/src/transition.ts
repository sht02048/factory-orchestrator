import type { RunState } from "./run.js";

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

export function transitionRun(from: RunState, to: RunState): RunTransitionResult {
  if (!canTransitionRun(from, to)) {
    return { ok: false, error: { kind: "invalid-transition", from, to } };
  }
  return { ok: true, state: to };
}

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
