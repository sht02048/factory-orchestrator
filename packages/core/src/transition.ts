import type { RunState } from "./run.js";

const NEXT_STATES: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  queued: new Set(["running", "ended"]),
  running: new Set(["waiting-for-input", "paused", "disconnected", "ended"]),
  "waiting-for-input": new Set(["running", "disconnected", "ended"]),
  paused: new Set(["running", "disconnected", "ended"]),
  disconnected: new Set(["running", "waiting-for-input", "paused", "ended"]),
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
    case "paused":
      return { ok: true, action: "stop-agent-then-end" };
    case "disconnected":
      return { ok: true, action: "wait-for-reconnect" };
    case "ended":
      return { ok: false, reason: "already-ended" };
  }
}

export type RunControl = "pause" | "resume";

export type RunControlPlan =
  | { ok: true }
  | { ok: false; reason: "already-ended" | "not-running" | "not-paused" };

export function planRunControl(state: RunState, control: RunControl): RunControlPlan {
  if (state === "ended") return { ok: false, reason: "already-ended" };
  switch (control) {
    case "pause":
      return state === "running" ? { ok: true } : { ok: false, reason: "not-running" };
    case "resume":
      return state === "paused" ? { ok: true } : { ok: false, reason: "not-paused" };
  }
}

export const RUN_CONTROL_FAILURES = [
  "runner-unreachable",
  "agent-not-running",
  "runner-error",
  "state-changed",
] as const;
export type RunControlFailure = (typeof RUN_CONTROL_FAILURES)[number];

export function isRunControlFailure(value: string | null): value is RunControlFailure {
  return RUN_CONTROL_FAILURES.some((failure) => failure === value);
}
