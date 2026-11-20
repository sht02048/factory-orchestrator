import type { RunId, RunnerId, TrackerConnectionId } from "@ganger/core";
import { asc, eq, gt, lt, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import type { WorkspaceId } from "./ids.js";
import type { ChangeKind, ChangePart } from "./change-events-model.js";
import { changeEvents, changeEventsPruned, runs, trackerReadGenerations } from "./schema.js";

export { CHANGE_KINDS, CHANGE_PARTS } from "./change-events-model.js";
export type { ChangeKind, ChangePart } from "./change-events-model.js";

export const CHANGE_EVENTS_KEEP_MS = 24 * 60 * 60 * 1000;

export interface ChangeEvent {
  seq: number;
  kind: ChangeKind;
  targetId: string | null;
  workspaceId: WorkspaceId | null;
  part: ChangePart | null;
}

type RecordedKind = Exclude<ChangeKind, "tracker">;

interface ChangeInput {
  kind: RecordedKind;
  targetId: string | null;
  workspaceId: WorkspaceId | null;
  part?: ChangePart;
}

function insertChange(
  db: Database,
  input: ChangeInput | { kind: "tracker"; targetId: TrackerConnectionId; workspaceId: null },
  now: Date,
): void {
  db.insert(changeEvents)
    .values({
      kind: input.kind,
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      part: "part" in input ? (input.part ?? null) : null,
      at: now,
    })
    .run();
}

export function recordChange(db: Database, input: ChangeInput, now: Date = new Date()): void {
  insertChange(db, input, now);
}

export function recordRunChange(
  db: Database,
  runId: RunId,
  options: { part?: ChangePart; now?: Date } = {},
): void {
  const run = db
    .select({ workspaceId: runs.workspaceId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (run === undefined) return;
  insertChange(
    db,
    {
      kind: "run",
      targetId: runId,
      workspaceId: run.workspaceId,
      ...(options.part === undefined ? {} : { part: options.part }),
    },
    options.now ?? new Date(),
  );
}

export function recordRunnerChange(db: Database, runnerId: RunnerId, now: Date = new Date()): void {
  insertChange(db, { kind: "runner", targetId: runnerId, workspaceId: null }, now);
}

export function recordSettingsChange(
  db: Database,
  target: { targetId: string | null; workspaceId: WorkspaceId | null } = {
    targetId: null,
    workspaceId: null,
  },
  now: Date = new Date(),
): void {
  insertChange(db, { kind: "settings", ...target }, now);
}

export function markTrackerReadsStale(db: Database, connection: TrackerConnectionId): void {
  db.insert(trackerReadGenerations)
    .values({ trackerConnectionId: connection, generation: 1 })
    .onConflictDoUpdate({
      target: trackerReadGenerations.trackerConnectionId,
      set: { generation: sql`${trackerReadGenerations.generation} + 1` },
    })
    .run();
}

export function markTrackerChanged(
  db: Database,
  connection: TrackerConnectionId,
  now: Date = new Date(),
): void {
  inTransaction(db, () => {
    markTrackerReadsStale(db, connection);
    insertChange(db, { kind: "tracker", targetId: connection, workspaceId: null }, now);
  });
}

const sequenceRow = z.object({ seq: z.number() });

function lastIssuedSeq(db: Database): number {
  const raw = db.$client
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'change_events'")
    .get();
  return raw === undefined ? 0 : sequenceRow.parse(raw).seq;
}

export function prunedChangeSeq(db: Database): number {
  return (
    db
      .select({ throughSeq: changeEventsPruned.throughSeq })
      .from(changeEventsPruned)
      .where(eq(changeEventsPruned.id, 1))
      .get()?.throughSeq ?? 0
  );
}

export function latestChangeSeq(db: Database): number {
  const kept =
    db
      .select({ seq: max(changeEvents.seq) })
      .from(changeEvents)
      .get()?.seq ?? 0;
  return Math.max(kept, lastIssuedSeq(db), prunedChangeSeq(db));
}

export type ChangeResume =
  | { kind: "resume"; latest: number }
  | { kind: "reset"; latest: number; reason: "pruned" | "ahead" };

export function changeResumeFrom(db: Database, after: number): ChangeResume {
  const latest = latestChangeSeq(db);
  if (after > latest) return { kind: "reset", latest, reason: "ahead" };
  if (after < prunedChangeSeq(db)) return { kind: "reset", latest, reason: "pruned" };
  return { kind: "resume", latest };
}

export function listChangesAfter(db: Database, after: number, limit = 500): ChangeEvent[] {
  return db
    .select({
      seq: changeEvents.seq,
      kind: changeEvents.kind,
      targetId: changeEvents.targetId,
      workspaceId: changeEvents.workspaceId,
      part: changeEvents.part,
    })
    .from(changeEvents)
    .where(gt(changeEvents.seq, after))
    .orderBy(asc(changeEvents.seq))
    .limit(limit)
    .all();
}

export function pruneChangeEvents(
  db: Database,
  now: Date = new Date(),
  keepMs: number = CHANGE_EVENTS_KEEP_MS,
): number {
  return inTransaction(db, () => {
    const cutoff = new Date(now.getTime() - keepMs);
    const through = db
      .select({ seq: max(changeEvents.seq) })
      .from(changeEvents)
      .where(lt(changeEvents.at, cutoff))
      .get()?.seq;
    if (through === null || through === undefined) return 0;
    const deleted = db.delete(changeEvents).where(lte(changeEvents.seq, through)).run().changes;
    db.insert(changeEventsPruned)
      .values({ id: 1, throughSeq: through })
      .onConflictDoUpdate({
        target: changeEventsPruned.id,
        set: { throughSeq: sql`max(${changeEventsPruned.throughSeq}, ${through})` },
      })
      .run();
    return Number(deleted);
  });
}
