import { toRunId } from "@ganger/core";
import { requestRunCancel, requestWorktreeRemoval } from "@ganger/db";
import type { Database } from "@ganger/db";

export type RunActionResult = { ok: true } | { ok: false; reason: string };

export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}

export function removeWorktreeRequest(db: Database, runId: string, now: Date): RunActionResult {
  return requestWorktreeRemoval(db, toRunId(runId), now);
}
