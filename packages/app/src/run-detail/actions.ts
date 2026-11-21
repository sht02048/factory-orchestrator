import { toRunId } from "@ganger/core";
import { continueRun, requestRunCancel, requestWorktreeRemoval } from "@ganger/db";
import type { ContinueRunBlock } from "@ganger/db";
import type { Database } from "@ganger/db";

export type RunActionResult = { ok: true } | { ok: false; reason: string };

export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}

export function removeWorktreeRequest(db: Database, runId: string, now: Date): RunActionResult {
  return requestWorktreeRemoval(db, toRunId(runId), now);
}

export type ContinueRunActionResult =
  | { ok: true; runId: string }
  | { ok: false; reason: ContinueRunBlock };

export function continueRunRequest(
  db: Database,
  runId: string,
  message: string,
  now: Date,
): ContinueRunActionResult {
  const result = continueRun(db, { from: toRunId(runId), message, now });
  return result.ok ? { ok: true, runId: result.run.id } : result;
}
