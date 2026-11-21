import { createHash } from "node:crypto";
import type { RunActionRequestId, RunId } from "@ganger/core";
import { and, eq } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { runActionRequests } from "./schema.js";

export interface RunActionRequest {
  runId: RunId;
  requestId: RunActionRequestId;
  action: string;
  payload: ReadonlyArray<string>;
}

export interface RunActionHandlers<Result extends { ok: boolean }> {
  act: () => Result;
  replay: (resultRunId: RunId | null) => Result;
  reused: () => Result;
  resultRunId?: (result: Result) => RunId | null;
}

function fingerprintOf(request: RunActionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.action, ...request.payload]))
    .digest("hex");
}

export function handleRunActionOnce<Result extends { ok: boolean }>(
  db: Database,
  request: RunActionRequest,
  now: Date,
  handlers: RunActionHandlers<Result>,
): Result {
  const fingerprint = fingerprintOf(request);
  return inTransaction(db, (): Result => {
    const handled = db
      .select({
        fingerprint: runActionRequests.fingerprint,
        resultRunId: runActionRequests.resultRunId,
      })
      .from(runActionRequests)
      .where(
        and(
          eq(runActionRequests.runId, request.runId),
          eq(runActionRequests.requestId, request.requestId),
        ),
      )
      .get();
    if (handled !== undefined) {
      return handled.fingerprint === fingerprint
        ? handlers.replay(handled.resultRunId)
        : handlers.reused();
    }
    const result = handlers.act();
    if (result.ok) {
      db.insert(runActionRequests)
        .values({
          runId: request.runId,
          requestId: request.requestId,
          fingerprint,
          resultRunId: handlers.resultRunId?.(result) ?? null,
          handledAt: now,
        })
        .run();
    }
    return result;
  });
}
