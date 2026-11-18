import type { PermissionRequestId, PermissionWait, RunId } from "@factory/core";
import { and, asc, eq, inArray, isNotNull, isNull, not } from "drizzle-orm";
import type { Database } from "./database.js";
import { runPermissionWaits } from "./schema.js";

export interface StoredPermissionWait {
  runId: RunId;
  id: PermissionRequestId;
  detail: string;
  requestedAt: Date;
  resolvedAt: Date | null;
  denial: { reason: string; deniedAt: Date; sentAt: Date | null } | null;
}

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
