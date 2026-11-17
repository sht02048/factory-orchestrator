import { toRunId, toRunnerId } from "@factory/core";
import type { RunId, RunnerHealth, RunnerId } from "@factory/core";
import { z } from "zod";
import type { Database } from "./database.js";

// ---------- web이 남기는 요청(Q61) ----------

/**
 * 요청 하나의 모습. web이 남기고 worker가 처리해 결과를 쓴다. 대상마다 하나이고 다음 요청이 덮어쓴다.
 * `pending`은 요청을 받았지만 아직 결과가 없다는 뜻이다.
 */
export type RequestStatus<T> =
  | { status: "pending"; requestedAt: Date }
  | { status: "done"; requestedAt: Date; completedAt: Date; result: T }
  | { status: "failed"; requestedAt: Date; completedAt: Date; error: string };

const requestRow = z.object({
  requested_at: z.number().int(),
  completed_at: z.number().int().nullable(),
  payload: z.string().nullable(),
  error: z.string().nullable(),
});

function readRequest<T>(raw: unknown, parse: (payload: string) => T): RequestStatus<T> {
  const row = requestRow.parse(raw);
  const requestedAt = new Date(row.requested_at);
  if (row.completed_at === null) return { status: "pending", requestedAt };
  const completedAt = new Date(row.completed_at);
  if (row.error !== null) return { status: "failed", requestedAt, completedAt, error: row.error };
  return { status: "done", requestedAt, completedAt, result: parse(row.payload ?? "null") };
}

/** Run 상세가 로그 꼬리를 요청한다(0022). 결과를 지우고 다시 기다린다. */
export function requestLogTail(db: Database, runId: RunId, now: Date = new Date()): void {
  db.prepare(
    `INSERT INTO log_tail_requests (run_id, requested_at) VALUES (?, ?)
     ON CONFLICT (run_id) DO UPDATE SET
       requested_at = excluded.requested_at, completed_at = NULL, lines = NULL, error = NULL`,
  ).run(runId, now.getTime());
}

/** 처리할 로그 꼬리 요청(0017) */
export function listPendingLogTailRequests(
  db: Database,
): Array<{ runId: RunId; requestedAt: Date }> {
  const row = z.object({ run_id: z.string(), requested_at: z.number().int() });
  return db
    .prepare(
      "SELECT run_id, requested_at FROM log_tail_requests WHERE completed_at IS NULL ORDER BY requested_at",
    )
    .all()
    .map((raw) => {
      const r = row.parse(raw);
      return { runId: toRunId(r.run_id), requestedAt: new Date(r.requested_at) };
    });
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
      .prepare(
        `UPDATE log_tail_requests SET completed_at = ?, lines = ?, error = ?
         WHERE run_id = ? AND requested_at = ? AND completed_at IS NULL`,
      )
      .run(
        input.completedAt.getTime(),
        "lines" in input ? JSON.stringify(input.lines) : null,
        "error" in input ? input.error : null,
        input.runId,
        input.requestedAt.getTime(),
      ).changes > 0
  );
}

const lines = z.array(z.string());

export function getLogTailRequest(db: Database, runId: RunId): RequestStatus<string[]> | null {
  const raw = db
    .prepare(
      "SELECT requested_at, completed_at, lines AS payload, error FROM log_tail_requests WHERE run_id = ?",
    )
    .get(runId);
  return raw === undefined ? null : readRequest(raw, (p) => lines.parse(JSON.parse(p)));
}

/** 온보딩·Settings가 러너 확인을 요청한다(0025·0026). */
export function requestRunnerCheck(db: Database, runnerId: RunnerId, now: Date = new Date()): void {
  db.prepare(
    `INSERT INTO runner_check_requests (runner_id, requested_at) VALUES (?, ?)
     ON CONFLICT (runner_id) DO UPDATE SET
       requested_at = excluded.requested_at, completed_at = NULL, result = NULL, error = NULL`,
  ).run(runnerId, now.getTime());
}

export function listPendingRunnerCheckRequests(
  db: Database,
): Array<{ runnerId: RunnerId; requestedAt: Date }> {
  const row = z.object({ runner_id: z.string(), requested_at: z.number().int() });
  return db
    .prepare(
      "SELECT runner_id, requested_at FROM runner_check_requests WHERE completed_at IS NULL ORDER BY requested_at",
    )
    .all()
    .map((raw) => {
      const r = row.parse(raw);
      return { runnerId: toRunnerId(r.runner_id), requestedAt: new Date(r.requested_at) };
    });
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
      .prepare(
        `UPDATE runner_check_requests SET completed_at = ?, result = ?, error = ?
         WHERE runner_id = ? AND requested_at = ? AND completed_at IS NULL`,
      )
      .run(
        input.completedAt.getTime(),
        "result" in input ? JSON.stringify(input.result) : null,
        "error" in input ? input.error : null,
        input.runnerId,
        input.requestedAt.getTime(),
      ).changes > 0
  );
}

/**
 * 러너 확인 결과. 결과는 JSON으로 저장한 RunnerHealth이고, 날짜는 문자열로 돌아온다.
 * 화면이 쓰는 형태로 파싱하는 일은 읽는 쪽이 맡는다.
 */
export function getRunnerCheckRequest(
  db: Database,
  runnerId: RunnerId,
): RequestStatus<unknown> | null {
  const raw = db
    .prepare(
      "SELECT requested_at, completed_at, result AS payload, error FROM runner_check_requests WHERE runner_id = ?",
    )
    .get(runnerId);
  return raw === undefined
    ? null
    : readRequest(raw, (p): unknown => {
        const value: unknown = JSON.parse(p);
        return value;
      });
}
