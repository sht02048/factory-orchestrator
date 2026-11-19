import type { RunControl, RunControlFailure, RunState } from "@ganger/core";

export type RunControlView =
  | { control: RunControl; status: "pending" }
  | { control: RunControl; status: "failed"; reason: RunControlFailure | "unknown" };

export type RunControlOutcome = "requested" | "state-changed";

export function availableRunControl(
  state: RunState,
  cancelling: boolean,
  control: RunControlView | null,
): RunControl | null {
  if (cancelling || control?.status === "pending") return null;
  if (state === "running") return "pause";
  if (state === "paused") return "resume";
  return null;
}
