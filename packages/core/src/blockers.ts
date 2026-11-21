import type { TrackerState } from "./adapters.js";
import type { TicketKey } from "./ids.js";

export const TICKET_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function priorityRank(priority: TicketPriority): number {
  return TICKET_PRIORITIES.indexOf(priority);
}

export interface TicketBlocker {
  key: TicketKey;
  title: string;
  state: TrackerState;
}

export interface TicketRelations {
  priority: TicketPriority;
  blockers: ReadonlyArray<TicketBlocker>;
}

export const NO_TICKET_RELATIONS: TicketRelations = { priority: "none", blockers: [] };

export interface StoredBlocker {
  key: TicketKey;
  title: string;
  stateName: string;
  stateCategory: string;
  inCycle: boolean;
}

export interface BlockerWaitInput {
  readAt: Date | null;
  readFailed: boolean;
  skipped: boolean;
  startRequested: boolean;
  blockers: ReadonlyArray<StoredBlocker>;
}

export type BlockerStuckCause = "canceled" | "unreadable" | "cycle";

export type BlockerWait =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "waiting"; blockers: ReadonlyArray<StoredBlocker> }
  | {
      kind: "stuck";
      cause: BlockerStuckCause;
      blocker: StoredBlocker | null;
      blockers: ReadonlyArray<StoredBlocker>;
    };

export function isBlockerFinished(category: string): boolean {
  return category === "completed";
}

export function decideBlockerWait(input: BlockerWaitInput): BlockerWait {
  if (input.skipped || input.startRequested) return { kind: "none" };
  const unfinished = input.blockers.filter((b) => !isBlockerFinished(b.stateCategory));
  if (input.readFailed) {
    return {
      kind: "stuck",
      cause: "unreadable",
      blocker: unfinished[0] ?? input.blockers[0] ?? null,
      blockers: input.blockers,
    };
  }
  if (input.readAt === null) return { kind: "checking" };
  if (unfinished.length === 0) return { kind: "none" };
  const inCycle = unfinished.find((b) => b.inCycle);
  if (inCycle !== undefined) {
    return { kind: "stuck", cause: "cycle", blocker: inCycle, blockers: input.blockers };
  }
  const canceled = unfinished.find((b) => b.stateCategory === "canceled");
  if (canceled !== undefined) {
    return { kind: "stuck", cause: "canceled", blocker: canceled, blockers: input.blockers };
  }
  return { kind: "waiting", blockers: unfinished };
}

export const MAX_CYCLE_WALK = 50;

export async function findBlockersInCycle(input: {
  ticket: TicketKey;
  blockers: ReadonlyArray<TicketBlocker>;
  read: (key: TicketKey) => Promise<ReadonlyArray<TicketBlocker> | null>;
}): Promise<Set<TicketKey>> {
  const inCycle = new Set<TicketKey>();
  for (const direct of input.blockers) {
    if (isBlockerFinished(direct.state.category)) continue;
    if (await reachesTicket(direct.key, input.ticket, input.read)) inCycle.add(direct.key);
  }
  return inCycle;
}

async function reachesTicket(
  from: TicketKey,
  ticket: TicketKey,
  read: (key: TicketKey) => Promise<ReadonlyArray<TicketBlocker> | null>,
): Promise<boolean> {
  if (from === ticket) return true;
  const visited = new Set<TicketKey>([from]);
  const pending: TicketKey[] = [from];
  while (pending.length > 0 && visited.size <= MAX_CYCLE_WALK) {
    const key = pending.pop();
    if (key === undefined) break;
    const blockers = (await read(key)) ?? [];
    for (const blocker of blockers) {
      if (isBlockerFinished(blocker.state.category)) continue;
      if (blocker.key === ticket) return true;
      if (visited.has(blocker.key)) continue;
      visited.add(blocker.key);
      pending.push(blocker.key);
    }
  }
  return false;
}
