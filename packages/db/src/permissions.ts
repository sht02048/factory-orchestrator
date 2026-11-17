import type { PermissionRequestId, PermissionWait, RunId } from "@factory/core";
import { and, asc, eq, inArray, isNotNull, isNull, not } from "drizzle-orm";
import type { Database } from "./database.js";
import { runPermissionWaits } from "./schema.js";

/**
 * 에이전트 권한 대기와 운영자 거절(Q82.4·Q82.5). 러너는 메일을 소비하지 않고 읽으므로 어떤 대기를 받았고
 * 거절했는지는 이 표가 기준이다. 허용은 러너 화면에서 사람만 한다.
 *
 * 흐름: worker가 폴링에서 본 대기를 쓴다(recordPermissionWaits) → 폴링에 더 이상 없는 대기를 닫는다
 * (resolvePermissionWaits) → web이 운영자의 거절을 남긴다(거절 요청, denyPermissionWait) → worker가
 * 보낼 거절을 꺼내(listUnsentDenials) 러너에 보내고 한 번만 표시한다(markDenialSent) → 진행 판단은 보낸
 * 거절을 거른다(sentDenialIds, core resolveRunProgress의 `denied`).
 */
export interface StoredPermissionWait {
  runId: RunId;
  id: PermissionRequestId;
  detail: string;
  requestedAt: Date;
  /** 폴링에서 더 이상 열려 있지 않은 것을 본 시각 */
  resolvedAt: Date | null;
  denial: { reason: string; deniedAt: Date; sentAt: Date | null } | null;
}

/** 폴링에서 본 대기를 쓴다. 이미 쓴 대기는 건드리지 않는다. 새로 쓴 수를 돌려준다. */
export function recordPermissionWaits(
  db: Database,
  runId: RunId,
  waits: ReadonlyArray<PermissionWait>,
): number {
  let recorded = 0;
  for (const wait of waits) {
    recorded += Number(
      db
        .insert(runPermissionWaits)
        .values({
          runId,
          permissionId: wait.id,
          detail: wait.detail,
          requestedAt: wait.requestedAt,
        })
        .onConflictDoNothing()
        .run().changes,
    );
  }
  return recorded;
}

/**
 * 폴링에서 열려 있는 대기가 `open`뿐이면 나머지 열린 대기를 닫는다(러너에서 허용했거나 거절이 닿았다).
 * 닫은 수를 돌려준다.
 */
export function resolvePermissionWaits(
  db: Database,
  runId: RunId,
  open: ReadonlyArray<PermissionRequestId>,
  now: Date = new Date(),
): number {
  const result = db
    .update(runPermissionWaits)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(runPermissionWaits.runId, runId),
        isNull(runPermissionWaits.resolvedAt),
        open.length === 0 ? undefined : not(inArray(runPermissionWaits.permissionId, [...open])),
      ),
    )
    .run();
  return Number(result.changes);
}

export type DenyPermissionWaitResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-denied" | "resolved" };

/**
 * 운영자가 권한 대기를 거절한다(web의 거절 요청). 대기 하나에 거절은 하나다. 이미 거절했거나 닫힌 대기는
 * 바꾸지 않는다.
 */
export function denyPermissionWait(
  db: Database,
  input: { runId: RunId; permissionId: PermissionRequestId; reason: string },
  now: Date = new Date(),
): DenyPermissionWaitResult {
  const where = and(
    eq(runPermissionWaits.runId, input.runId),
    eq(runPermissionWaits.permissionId, input.permissionId),
  );
  const changed = db
    .update(runPermissionWaits)
    .set({ denyReason: input.reason, deniedAt: now })
    .where(and(where, isNull(runPermissionWaits.deniedAt), isNull(runPermissionWaits.resolvedAt)))
    .run().changes;
  if (changed > 0) return { ok: true };
  const row = db
    .select({
      deniedAt: runPermissionWaits.deniedAt,
      resolvedAt: runPermissionWaits.resolvedAt,
    })
    .from(runPermissionWaits)
    .where(where)
    .get();
  if (row === undefined) return { ok: false, reason: "not-found" };
  return { ok: false, reason: row.deniedAt === null ? "resolved" : "already-denied" };
}

/** 거절을 남겼지만 아직 러너에 보내지 않은 대기. 거절한 순서다(worker, 0016). */
export function listUnsentDenials(db: Database): Array<{
  runId: RunId;
  permissionId: PermissionRequestId;
  reason: string;
  deniedAt: Date;
}> {
  return db
    .select({
      runId: runPermissionWaits.runId,
      permissionId: runPermissionWaits.permissionId,
      reason: runPermissionWaits.denyReason,
      deniedAt: runPermissionWaits.deniedAt,
    })
    .from(runPermissionWaits)
    .where(and(isNotNull(runPermissionWaits.deniedAt), isNull(runPermissionWaits.denySentAt)))
    .orderBy(asc(runPermissionWaits.deniedAt), asc(runPermissionWaits.permissionId))
    .all()
    .flatMap((row) =>
      row.reason === null || row.deniedAt === null
        ? []
        : [{ ...row, reason: row.reason, deniedAt: row.deniedAt }],
    );
}

/**
 * 거절을 러너에 보냈다고 표시한다. 한 번만 참이다. 이미 표시했으면 false라 같은 거절을 두 번 처리하지 않는다.
 */
export function markDenialSent(
  db: Database,
  input: { runId: RunId; permissionId: PermissionRequestId },
  now: Date = new Date(),
): boolean {
  return (
    db
      .update(runPermissionWaits)
      .set({ denySentAt: now })
      .where(
        and(
          eq(runPermissionWaits.runId, input.runId),
          eq(runPermissionWaits.permissionId, input.permissionId),
          isNotNull(runPermissionWaits.deniedAt),
          isNull(runPermissionWaits.denySentAt),
        ),
      )
      .run().changes > 0
  );
}

/** 거절을 보낸 대기. core resolveRunProgress의 `denied`에 넣는다. */
export function sentDenialIds(db: Database, runId: RunId): Set<PermissionRequestId> {
  return new Set(
    db
      .select({ id: runPermissionWaits.permissionId })
      .from(runPermissionWaits)
      .where(and(eq(runPermissionWaits.runId, runId), isNotNull(runPermissionWaits.denySentAt)))
      .all()
      .map((row) => row.id),
  );
}

/** 런의 권한 대기 전부. 받은 순서다(Run 상세 타임라인, 손댈 일). */
export function listRunPermissionWaits(db: Database, runId: RunId): StoredPermissionWait[] {
  return db
    .select()
    .from(runPermissionWaits)
    .where(eq(runPermissionWaits.runId, runId))
    .orderBy(asc(runPermissionWaits.requestedAt), asc(runPermissionWaits.permissionId))
    .all()
    .map((row) => ({
      runId: row.runId,
      id: row.permissionId,
      detail: row.detail,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt,
      denial:
        row.denyReason === null || row.deniedAt === null
          ? null
          : { reason: row.denyReason, deniedAt: row.deniedAt, sentAt: row.denySentAt },
    }));
}
