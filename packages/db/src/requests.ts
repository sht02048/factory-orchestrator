import { planCancel } from "@factory/core";
import type { RunId, RunnerHealth, RunnerId } from "@factory/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { logTailRequests, runCancelRequests, runnerCheckRequests, runs } from "./schema.js";

export type RequestStatus<T> =
  | { status: "pending"; requestedAt: Date }
  | { status: "done"; requestedAt: Date; completedAt: Date; result: T }
  | { status: "failed"; requestedAt: Date; completedAt: Date; error: string };

function toStatus<T>(row: {
  requestedAt: Date;
  completedAt: Date | null;
  error: string | null;
  result: T;
}): RequestStatus<T> {
  const { requestedAt, completedAt } = row;
  if (completedAt === null) return { status: "pending", requestedAt };
  if (row.error !== null) return { status: "failed", requestedAt, completedAt, error: row.error };
  return { status: "done", requestedAt, completedAt, result: row.result };
}

export function requestLogTail(db: Database, runId: RunId, now: Date = new Date()): void {
  db.insert(logTailRequests)
    .values({ runId, requestedAt: now })
    .onConflictDoUpdate({
      target: logTailRequests.runId,
      set: { requestedAt: now, completedAt: null, lines: null, error: null },
    })
    .run();
}

export function listPendingLogTailRequests(
  db: Database,
): Array<{ runId: RunId; requestedAt: Date }> {
  return db
    .select({ runId: logTailRequests.runId, requestedAt: logTailRequests.requestedAt })
    .from(logTailRequests)
    .where(isNull(logTailRequests.completedAt))
    .orderBy(asc(logTailRequests.requestedAt))
    .all();
}

export function completeLogTailRequest(
  db: Database,
  input: { runId: RunId; requestedAt: Date; completedAt: Date } & (
    | { lines: ReadonlyArray<string> }
    | { error: string }
  ),
): boolean {
  return (
    db
      .update(logTailRequests)
      .set({
        completedAt: input.completedAt,
        lines: "lines" in input ? [...input.lines] : null,
        error: "error" in input ? input.error : null,
      })
      .where(
        and(
          eq(logTailRequests.runId, input.runId),
          eq(logTailRequests.requestedAt, input.requestedAt),
          isNull(logTailRequests.completedAt),
        ),
      )
      .run().changes > 0
  );
}

export function getLogTailRequest(db: Database, runId: RunId): RequestStatus<string[]> | null {
  const row = db.select().from(logTailRequests).where(eq(logTailRequests.runId, runId)).get();
  return row === undefined ? null : toStatus({ ...row, result: row.lines ?? [] });
}

export function requestRunnerCheck(db: Database, runnerId: RunnerId, now: Date = new Date()): void {
  db.insert(runnerCheckRequests)
    .values({ runnerId, requestedAt: now })
    .onConflictDoUpdate({
      target: runnerCheckRequests.runnerId,
      set: { requestedAt: now, completedAt: null, result: null, error: null },
    })
    .run();
}

export function listPendingRunnerCheckRequests(
  db: Database,
): Array<{ runnerId: RunnerId; requestedAt: Date }> {
  return db
    .select({
      runnerId: runnerCheckRequests.runnerId,
      requestedAt: runnerCheckRequests.requestedAt,
    })
    .from(runnerCheckRequests)
    .where(isNull(runnerCheckRequests.completedAt))
    .orderBy(asc(runnerCheckRequests.requestedAt))
    .all();
}

export function completeRunnerCheckRequest(
  db: Database,
  input: { runnerId: RunnerId; requestedAt: Date; completedAt: Date } & (
    | { result: RunnerHealth }
    | { error: string }
  ),
): boolean {
  return (
    db
      .update(runnerCheckRequests)
      .set({
        completedAt: input.completedAt,
        result: "result" in input ? JSON.stringify(input.result) : null,
        error: "error" in input ? input.error : null,
      })
      .where(
        and(
          eq(runnerCheckRequests.runnerId, input.runnerId),
          eq(runnerCheckRequests.requestedAt, input.requestedAt),
          isNull(runnerCheckRequests.completedAt),
        ),
      )
      .run().changes > 0
  );
}

export function getRunnerCheckRequest(
  db: Database,
  runnerId: RunnerId,
): RequestStatus<unknown> | null {
  const row = db
    .select()
    .from(runnerCheckRequests)
    .where(eq(runnerCheckRequests.runnerId, runnerId))
    .get();
  if (row === undefined) return null;
  const result: unknown = row.result === null ? null : JSON.parse(row.result);
  return toStatus({ ...row, result });
}

export type RequestRunCancelResult =
  | { ok: true; requestedAt: Date }
  | { ok: false; reason: "not-found" | "already-ended" };

export function requestRunCancel(
  db: Database,
  runId: RunId,
  now: Date = new Date(),
): RequestRunCancelResult {
  return inTransaction(db, (): RequestRunCancelResult => {
    const run = db.select({ state: runs.state }).from(runs).where(eq(runs.id, runId)).get();
    if (run === undefined) return { ok: false, reason: "not-found" };
    const plan = planCancel(run.state);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    db.insert(runCancelRequests).values({ runId, requestedAt: now }).onConflictDoNothing().run();
    const stored = db
      .select({ requestedAt: runCancelRequests.requestedAt })
      .from(runCancelRequests)
      .where(eq(runCancelRequests.runId, runId))
      .get();
    return { ok: true, requestedAt: stored?.requestedAt ?? now };
  });
}

export function listPendingCancelRequests(
  db: Database,
): Array<{ runId: RunId; requestedAt: Date }> {
  return db
    .select({ runId: runCancelRequests.runId, requestedAt: runCancelRequests.requestedAt })
    .from(runCancelRequests)
    .where(isNull(runCancelRequests.processedAt))
    .orderBy(asc(runCancelRequests.requestedAt), asc(runCancelRequests.runId))
    .all();
}

export function getRunCancelRequest(
  db: Database,
  runId: RunId,
): { requestedAt: Date; processedAt: Date | null } | null {
  return (
    db
      .select({
        requestedAt: runCancelRequests.requestedAt,
        processedAt: runCancelRequests.processedAt,
      })
      .from(runCancelRequests)
      .where(eq(runCancelRequests.runId, runId))
      .get() ?? null
  );
}

export function hasPendingCancelRequest(db: Database, runId: RunId): boolean {
  return (
    db
      .select({ runId: runCancelRequests.runId })
      .from(runCancelRequests)
      .where(and(eq(runCancelRequests.runId, runId), isNull(runCancelRequests.processedAt)))
      .get() !== undefined
  );
}

export function markCancelRequestProcessed(
  db: Database,
  runId: RunId,
  now: Date = new Date(),
): boolean {
  return (
    db
      .update(runCancelRequests)
      .set({ processedAt: now })
      .where(and(eq(runCancelRequests.runId, runId), isNull(runCancelRequests.processedAt)))
      .run().changes > 0
  );
}
