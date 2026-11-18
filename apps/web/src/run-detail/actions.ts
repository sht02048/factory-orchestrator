import { toRunId } from "@factory/core";
import { requestRunCancel } from "@factory/db";
import type { Database } from "@factory/db";

export type RunActionResult = { ok: true } | { ok: false; reason: string };

export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}
