import { NO_TICKET_RELATIONS, decideBlockerWait, findBlockersInCycle } from "@ganger/core";
import type { TicketKey, TicketRelations, TrackerConnectionId } from "@ganger/core";
import {
  getRunBlockerState,
  listQueuedBlockerStates,
  listRuns,
  markRunRelationsUnread,
  recordRunRelations,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { tryWrite } from "./context.js";
import type { TickContext } from "./context.js";

export const BLOCKER_POLL_INTERVAL_MS = 60_000;

export const BLOCKER_START_FRESH_MS = 10_000;

export interface BlockerRefreshState {
  nextPollAt: number;
  changedTickets: Set<string>;
}

export function createBlockerRefreshState(): BlockerRefreshState {
  return { nextPollAt: 0, changedTickets: new Set() };
}

function ticketId(connection: TrackerConnectionId, key: TicketKey): string {
  return `${connection}\n${key}`;
}

export function noteTicketChanged(
  state: BlockerRefreshState,
  connection: TrackerConnectionId,
  key: TicketKey,
): void {
  state.changedTickets.add(ticketId(connection, key));
}

type RelationReads = Map<string, Promise<TicketRelations | null>>;

export async function refreshBlockers(context: TickContext): Promise<void> {
  try {
    const { blockerRefresh: refresh, db } = context;
    const nowMs = context.now().getTime();
    const pollDue = nowMs >= refresh.nextPollAt;
    if (pollDue) refresh.nextPollAt = nowMs + BLOCKER_POLL_INTERVAL_MS;
    const changed = new Set(refresh.changedTickets);
    refresh.changedTickets.clear();

    const states = listQueuedBlockerStates(db);
    const reads: RelationReads = new Map();
    for (const run of listRuns(db, { states: ["queued"] })) {
      const state = states.get(run.id);
      if (state === undefined || state.skipped || state.startRequested) continue;
      const { connection, key } = run.ticket;
      const touched =
        changed.has(ticketId(connection, key)) ||
        state.blockers.some((blocker) => changed.has(ticketId(connection, blocker.key)));
      const wait = decideBlockerWait(state).kind;
      if (wait === "checking" || touched || (pollDue && wait !== "none")) {
        await readRunRelations(context, run, reads);
      }
    }
  } catch (error) {
    context.logger.warn("run.blockers_refresh_failed", { error });
  }
}

export async function blockersClearToStart(context: TickContext, run: StoredRun): Promise<boolean> {
  const before = getRunBlockerState(context.db, run.id);
  if (before === null) return false;
  if (before.skipped || before.startRequested) return true;
  const age =
    before.readAt === null
      ? Number.POSITIVE_INFINITY
      : context.now().getTime() - before.readAt.getTime();
  if (age > BLOCKER_START_FRESH_MS || before.readFailed) {
    if (!(await readRunRelations(context, run, new Map()))) return false;
  }
  const after = getRunBlockerState(context.db, run.id);
  return after !== null && decideBlockerWait(after).kind === "none";
}

async function readRunRelations(
  context: TickContext,
  run: StoredRun,
  reads: RelationReads,
): Promise<boolean> {
  const { db, logger } = context;
  const { connection, key } = run.ticket;
  const failed = (error: unknown): false => {
    logger.warn("run.blockers_read_failed", { runId: run.id, ticketKey: key, error });
    tryWrite(context, run.id, () => markRunRelationsUnread(db, run.id, context.now()));
    return false;
  };
  try {
    const tracker = context.adapters.tracker(db, connection);
    if (tracker === null) return failed(new Error("tracker connection missing"));
    const read = (ticket: TicketKey): Promise<TicketRelations | null> => {
      const id = ticketId(connection, ticket);
      const known = reads.get(id);
      if (known !== undefined) return known;
      const started = tracker.getTicketRelations?.(ticket) ?? Promise.resolve(NO_TICKET_RELATIONS);
      reads.set(id, started);
      return started;
    };
    const relations = (await read(key)) ?? NO_TICKET_RELATIONS;
    const inCycle = await findBlockersInCycle({
      ticket: key,
      blockers: relations.blockers,
      read: async (ticket) => {
        try {
          return (await read(ticket))?.blockers ?? null;
        } catch {
          return null;
        }
      },
    });
    const written = tryWrite(context, run.id, () =>
      recordRunRelations(db, run.id, { ...relations, inCycle }, context.now()),
    );
    return written === true;
  } catch (error) {
    return failed(error);
  }
}
