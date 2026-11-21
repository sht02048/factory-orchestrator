import { decideBlockerWait } from "@ganger/core";
import type {
  BlockerWaitInput,
  RunId,
  StoredBlocker,
  TicketBlocker,
  TicketKey,
  TicketPriority,
} from "@ganger/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { recordRunChange } from "./change-events.js";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { hasPendingCancelRequest } from "./requests.js";
import { runBlockers, runWaitSkipRequests, runs } from "./schema.js";

export interface RunBlockerState extends BlockerWaitInput {
  priority: TicketPriority;
}

const stateColumns = {
  id: runs.id,
  priority: runs.ticketPriority,
  readAt: runs.blockersReadAt,
  readFailed: runs.blockersReadFailed,
  skippedAt: runs.waitSkippedAt,
  startRequestedAt: runs.startRequestedAt,
};

function blockersByRun(db: Database, runIds: ReadonlyArray<RunId>): Map<RunId, StoredBlocker[]> {
  const result = new Map<RunId, StoredBlocker[]>();
  if (runIds.length === 0) return result;
  const rows = db
    .select()
    .from(runBlockers)
    .where(inArray(runBlockers.runId, [...runIds]))
    .orderBy(asc(runBlockers.blockerKey))
    .all();
  for (const row of rows) {
    const list = result.get(row.runId) ?? [];
    list.push({
      key: row.blockerKey,
      title: row.title,
      stateName: row.stateName,
      stateCategory: row.stateCategory,
      inCycle: row.inCycle,
    });
    result.set(row.runId, list);
  }
  return result;
}

export function listQueuedBlockerStates(db: Database): Map<RunId, RunBlockerState> {
  const rows = db.select(stateColumns).from(runs).where(eq(runs.state, "queued")).all();
  const blockers = blockersByRun(
    db,
    rows.map((row) => row.id),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        priority: row.priority ?? "none",
        readAt: row.readAt,
        readFailed: row.readFailed,
        skipped: row.skippedAt !== null,
        startRequested: row.startRequestedAt !== null,
        blockers: blockers.get(row.id) ?? [],
      },
    ]),
  );
}

export function getRunBlockerState(db: Database, runId: RunId): RunBlockerState | null {
  const row = db.select(stateColumns).from(runs).where(eq(runs.id, runId)).get();
  if (row === undefined) return null;
  return {
    priority: row.priority ?? "none",
    readAt: row.readAt,
    readFailed: row.readFailed,
    skipped: row.skippedAt !== null,
    startRequested: row.startRequestedAt !== null,
    blockers: blockersByRun(db, [runId]).get(runId) ?? [],
  };
}

function sameBlockers(a: ReadonlyArray<StoredBlocker>, b: ReadonlyArray<StoredBlocker>): boolean {
  const sorted = (list: ReadonlyArray<StoredBlocker>) =>
    JSON.stringify(list.toSorted((x, y) => x.key.localeCompare(y.key)));
  return sorted(a) === sorted(b);
}

export function recordRunRelations(
  db: Database,
  runId: RunId,
  input: {
    priority: TicketPriority;
    blockers: ReadonlyArray<TicketBlocker>;
    inCycle: ReadonlySet<TicketKey>;
  },
  now: Date,
): boolean {
  return inTransaction(db, () => {
    const before = getRunBlockerState(db, runId);
    const updated =
      db
        .update(runs)
        .set({ ticketPriority: input.priority, blockersReadAt: now, blockersReadFailed: false })
        .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
        .run().changes > 0;
    if (!updated || before === null) return false;
    const unique = [...new Map(input.blockers.map((b) => [b.key, b])).values()];
    const next: StoredBlocker[] = unique.map((blocker) => ({
      key: blocker.key,
      title: blocker.title,
      stateName: blocker.state.name,
      stateCategory: blocker.state.category,
      inCycle: input.inCycle.has(blocker.key),
    }));
    db.delete(runBlockers).where(eq(runBlockers.runId, runId)).run();
    if (next.length > 0) {
      db.insert(runBlockers)
        .values(
          next.map((blocker) => ({
            runId,
            blockerKey: blocker.key,
            title: blocker.title,
            stateName: blocker.stateName,
            stateCategory: blocker.stateCategory,
            inCycle: blocker.inCycle,
            readAt: now,
          })),
        )
        .run();
    }
    if (
      before.readAt === null ||
      before.readFailed ||
      before.priority !== input.priority ||
      !sameBlockers(before.blockers, next)
    ) {
      recordRunChange(db, runId, { now });
    }
    return true;
  });
}

export function markRunRelationsUnread(db: Database, runId: RunId, now: Date): boolean {
  return inTransaction(db, () => {
    const updated =
      db
        .update(runs)
        .set({ blockersReadFailed: true })
        .where(
          and(eq(runs.id, runId), eq(runs.state, "queued"), eq(runs.blockersReadFailed, false)),
        )
        .run().changes > 0;
    if (updated) recordRunChange(db, runId, { now });
    return updated;
  });
}

export type SkipBlockerWaitResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "not-queued" | "not-waiting" | "cancelling" };

export function skipBlockerWait(
  db: Database,
  runId: RunId,
  requestId: string,
  now: Date,
): SkipBlockerWaitResult {
  return inTransaction(db, (): SkipBlockerWaitResult => {
    const handled = db
      .select({ runId: runWaitSkipRequests.runId })
      .from(runWaitSkipRequests)
      .where(
        and(eq(runWaitSkipRequests.runId, runId), eq(runWaitSkipRequests.requestId, requestId)),
      )
      .get();
    if (handled !== undefined) return { ok: true };
    const run = db
      .select({ state: runs.state, skippedAt: runs.waitSkippedAt })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (run === undefined) return { ok: false, reason: "not-found" };
    if (run.state !== "queued") return { ok: false, reason: "not-queued" };
    if (hasPendingCancelRequest(db, runId)) return { ok: false, reason: "cancelling" };
    const remember = () =>
      db.insert(runWaitSkipRequests).values({ runId, requestId, requestedAt: now }).run();
    if (run.skippedAt !== null) {
      remember();
      return { ok: true };
    }
    const state = getRunBlockerState(db, runId);
    if (state === null) return { ok: false, reason: "not-found" };
    const wait = decideBlockerWait(state).kind;
    if (wait === "none" || wait === "checking") return { ok: false, reason: "not-waiting" };
    db.update(runs).set({ waitSkippedAt: now }).where(eq(runs.id, runId)).run();
    remember();
    recordRunChange(db, runId, { now });
    return { ok: true };
  });
}
