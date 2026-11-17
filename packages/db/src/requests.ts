import { planCancel } from "@factory/core";
import type { RunId, RunnerHealth, RunnerId } from "@factory/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { logTailRequests, runCancelRequests, runnerCheckRequests, runs } from "./schema.js";

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

// ---------- 런 취소 요청(Q77·Q82.8) ----------

export type RequestRunCancelResult =
  | { ok: true; requestedAt: Date }
  | { ok: false; reason: "not-found" | "already-ended" };

/**
 * 운영자가 런 취소를 요청한다(web, 스펙 3절 6번). 끝나지 않은 런(Queued·Running·Waiting for Input·
 * Disconnected)이면 받아들이고, Ended 런이면 거부한다(core planCancel). 이미 처리하지 않은 요청이 있으면
 * 그 요청을 그대로 둔다(처음 요청 시각을 남긴다).
 */
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

/** 처리하지 않은 취소 요청. 요청 순서다(worker, 0016). 화면의 "취소 중"도 이것으로 안다(Q82.21). */
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

/** 런에 처리하지 않은 취소 요청이 있는지(취소 중). */
export function hasPendingCancelRequest(db: Database, runId: RunId): boolean {
  return (
    db
      .select({ runId: runCancelRequests.runId })
      .from(runCancelRequests)
      .where(and(eq(runCancelRequests.runId, runId), isNull(runCancelRequests.processedAt)))
      .get() !== undefined
  );
}

/**
 * 취소 요청을 처리했다고 표시한다. 한 번만 참이다: 이미 표시했거나 요청이 없으면 false라, 둘이 함께
 * 처리하려 해도 한쪽만 처리한다. 런을 끝낸 쓰기와 같은 트랜잭션에서 부른다.
 */
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
