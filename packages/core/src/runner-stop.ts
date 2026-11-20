import type { AgentActivity, UnreportedStop } from "./adapters.js";
import type { PauseSource } from "./run.js";

export const TURN_ENDED_PAUSE_AFTER_MS = 10 * 60 * 1000;
export const STOP_NOTICE_SLACK_MS = 5 * 1000;

export type RunnerStopDecision =
  | {
      to: "paused";
      source: Exclude<PauseSource, "operator">;
      lastOutput: ReadonlyArray<string> | null;
    }
  | { to: "running" }
  | null;

export function decideRunnerStop(input: {
  state: "running" | "paused";
  activity: AgentActivity;
  unreportedStop: UnreportedStop | null;
  runningSince: Date | null;
  pausedSince: Date | null;
  now: Date;
}): RunnerStopDecision {
  const { activity } = input;
  if (input.state === "paused") {
    return activity.kind === "working" && isAfter(activity.since, input.pausedSince)
      ? { to: "running" }
      : null;
  }
  if (activity.kind === "working") return null;
  if (activity.kind === "interrupted" && isAfter(activity.since, input.runningSince)) {
    return { to: "paused", source: "runner", lastOutput: null };
  }
  const stop = input.unreportedStop;
  if (stop !== null && isAfter(stop.at, slackBefore(input.runningSince))) {
    return { to: "paused", source: "unreported", lastOutput: stop.lastOutput };
  }
  if (
    activity.kind === "turn-ended" &&
    isAfter(activity.since, input.runningSince) &&
    input.now.getTime() - activity.since.getTime() >= TURN_ENDED_PAUSE_AFTER_MS
  ) {
    return { to: "paused", source: "unreported", lastOutput: null };
  }
  return null;
}

function slackBefore(mark: Date | null): Date | null {
  return mark === null ? null : new Date(mark.getTime() - STOP_NOTICE_SLACK_MS);
}

function isAfter(at: Date, mark: Date | null): boolean {
  return mark !== null && at.getTime() > mark.getTime();
}
