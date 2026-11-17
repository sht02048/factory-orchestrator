import type { RunId, RunnerHealth, RunnerId } from "@factory/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { logTailRequests, runnerCheckRequests } from "./schema.js";

// ---------- web이 남기는 요청(Q61) ----------

/**
 * 요청 하나의 모습. web이 남기고 worker가 처리해 결과를 쓴다. 대상마다 하나이고 다음 요청이 덮어쓴다.
 * `pending`은 요청을 받았지만 아직 결과가 없다는 뜻이다.
 */
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

/** Run 상세가 로그 꼬리를 요청한다(0022). 결과를 지우고 다시 기다린다. */
export function requestLogTail(db: Database, runId: RunId, now: Date = new Date()): void {
  db.insert(logTailRequests)
    .values({ runId, requestedAt: now })
    .onConflictDoUpdate({
      target: logTailRequests.runId,
      set: { requestedAt: now, completedAt: null, lines: null, error: null },
    })
    .run();
}

/** 처리할 로그 꼬리 요청(0017) */
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

/**
 * 로그 꼬리 요청의 결과를 쓴다. 처리하는 동안 새 요청이 왔으면(`requestedAt`이 다르면) 쓰지 않는다.
 */
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

/** 온보딩·Settings가 러너 확인을 요청한다(0025·0026). */
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

/**
 * 러너 확인 결과. 결과는 JSON으로 저장한 RunnerHealth이고, 날짜는 문자열로 돌아온다.
 * 화면이 쓰는 형태로 파싱하는 일은 읽는 쪽이 맡는다(경계 파싱).
 */
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
