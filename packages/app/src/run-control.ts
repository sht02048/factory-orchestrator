import { isRunControlFailure, planRunControl, toRunId } from "@ganger/core";
import type { RunControl, RunState } from "@ganger/core";
import { getRunControlRequest, requestRunControl } from "@ganger/db";
import type { Database } from "@ganger/db";
import type { RunControlView } from "./run-control-view.js";

export const RUN_CONTROL_FAILURE_SHOWN_MS = 10 * 60_000;

export function runControlOf(
  db: Database,
  run: { id: string; state: RunState },
  now: Date,
): RunControlView | null {
  const request = getRunControlRequest(db, toRunId(run.id));
  if (request === null) return null;
  switch (request.status) {
    case "pending":
      return { control: request.control, status: "pending" };
    case "failed":
      return planRunControl(run.state, request.control).ok &&
        now.getTime() - request.completedAt.getTime() < RUN_CONTROL_FAILURE_SHOWN_MS
        ? {
            control: request.control,
            status: "failed",
            reason: isRunControlFailure(request.error) ? request.error : "unknown",
          }
        : null;
    case "done":
      return null;
  }
}

export function withoutPauses(
  executionMs: number | null,
  records: { pausedMs: number; pausedSince: Date | null } | undefined,
  now: Date,
): number | null {
  if (executionMs === null || records === undefined) return executionMs;
  const current =
    records.pausedSince === null ? 0 : Math.max(0, now.getTime() - records.pausedSince.getTime());
  return Math.max(0, executionMs - records.pausedMs - current);
}

export type RunControlActionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not-found" | "already-ended" | "not-running" | "not-paused" | "cancelling";
    };

export function requestControl(
  db: Database,
  runId: string,
  control: RunControl,
  now: Date,
): RunControlActionResult {
  const result = requestRunControl(db, toRunId(runId), control, now);
  return result.ok ? { ok: true } : result;
}
