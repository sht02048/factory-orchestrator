import { isRunControlFailure, planRunControl, toRunId } from "@ganger/core";
import type { RunControl, RunState } from "@ganger/core";
import { getRunControlRequest, requestRunControl } from "@ganger/db";
import type { Database } from "@ganger/db";
import type { RunControlView } from "./run-control-view.js";

export function runControlOf(
  db: Database,
  run: { id: string; state: RunState },
): RunControlView | null {
  const request = getRunControlRequest(db, toRunId(run.id));
  if (request === null) return null;
  switch (request.status) {
    case "pending":
      return { control: request.control, status: "pending" };
    case "failed":
      return planRunControl(run.state, request.control).ok
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
