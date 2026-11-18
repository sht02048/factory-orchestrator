import { checkAutoAssignment, labelJustAttached } from "@factory/core";
import type {
  AutoAssignmentRun,
  LabelId,
  TicketRef,
  TrackerConnectionId,
  TrackerProjectId,
  TrackerTicket,
} from "@factory/core";
import {
  assignRun,
  getAutoAssignLabel,
  getMapping,
  getWorkspaceTrackerProject,
  inTransaction,
  listRuns,
  listUnprocessedTrackerEvents,
  listWorkspaces,
  markTrackerEventProcessed,
} from "@factory/db";
import type { StoredMapping, StoredRun, StoredTrackerEvent } from "@factory/db";
import type { TickContext } from "./context.js";

export const POLL_CORRECTION_INTERVAL_MS = 60_000;

export const POLL_CORRECTION_FIRST_LOOKBACK_MS = 24 * 60 * 60_000;

const POLL_CORRECTION_OVERLAP_MS = 60_000;

export interface AutoAssignState {
  nextPollAt: number;
  polledAt: Map<string, number>;
}

export function createAutoAssignState(): AutoAssignState {
  return { nextPollAt: 0, polledAt: new Map() };
}

export async function assignAutomatically(context: TickContext): Promise<void> {
  try {
    processTrackerEvents(context);
    await correctByPolling(context);
  } catch (error) {
    context.logger.warn("could not assign automatically", { error });
  }
}

function processTrackerEvents(context: TickContext): void {
  const { db, now, logger } = context;
  const events = listUnprocessedTrackerEvents(db);
  const latestLabels = new Map<string, ReadonlyArray<LabelId>>();
  for (const event of events) {
    if (event.ticketKey === null) continue;
    const key = `${event.connection}\n${event.ticketKey}`;
    if (event.kind === "ticket.removed") latestLabels.set(key, []);
    else if (event.labelIds !== null) latestLabels.set(key, event.labelIds);
  }
  for (const event of events) {
    try {
      inTransaction(db, () => {
        const latest =
          event.ticketKey === null
            ? undefined
            : latestLabels.get(`${event.connection}\n${event.ticketKey}`);
        assignForEvent(context, event, latest ?? null);
        markTrackerEventProcessed(db, event.connection, event.deliveryId, now());
      });
    } catch (error) {
      logger.warn("could not process tracker event", {
        connection: event.connection,
        deliveryId: event.deliveryId,
        error,
      });
    }
  }
}

function assignForEvent(
  context: TickContext,
  event: StoredTrackerEvent,
  latestLabelIds: ReadonlyArray<LabelId> | null,
): void {
  if (event.kind !== "ticket.created" && event.kind !== "ticket.updated") return;
  if (event.ticketKey === null || event.projectId === null || event.labelIds === null) return;
  const target = autoAssignTarget(context, event.connection, event.projectId);
  if (target === null) return;
  if (!labelJustAttached(event, target.labelId)) return;
  if (latestLabelIds !== null && !latestLabelIds.includes(target.labelId)) return;

  const ticket: TicketRef = { connection: event.connection, key: event.ticketKey };
  const check = checkAutoAssignment({
    labelIds: event.labelIds,
    autoAssignLabelId: target.labelId,
    labelAttachedAt: event.receivedAt,
    ticket,
    runs: listRuns(context.db, { ticket }).map(toAutoAssignmentRun),
  });
  if (!check.ok) return;
  assign(context, ticket, event.projectId, target.mapping);
}

async function correctByPolling(context: TickContext): Promise<void> {
  const { autoAssign, logger } = context;
  const startedAt = context.now().getTime();
  if (startedAt < autoAssign.nextPollAt) return;
  autoAssign.nextPollAt = startedAt + POLL_CORRECTION_INTERVAL_MS;

  for (const { connection, labelId } of labelsToPoll(context)) {
    const tracker = trackerFor(context, connection);
    if (tracker === null) continue;
    const key = `${connection}\n${labelId}`;
    const since =
      (autoAssign.polledAt.get(key) ?? startedAt - POLL_CORRECTION_FIRST_LOOKBACK_MS) -
      POLL_CORRECTION_OVERLAP_MS;
    let tickets: ReadonlyArray<TrackerTicket>;
    try {
      tickets = await tracker.listLabeledTickets({ labelId, updatedSince: new Date(since) });
    } catch (error) {
      logger.warn("could not list labeled tickets", { connection, labelId, error });
      continue;
    }
    let complete = true;
    for (const ticket of tickets) {
      try {
        inTransaction(context.db, () =>
          assignForPolledTicket(context, connection, labelId, ticket),
        );
      } catch (error) {
        complete = false;
        logger.warn("could not assign a labeled ticket", {
          connection,
          ticketKey: ticket.key,
          error,
        });
      }
    }
    if (complete) autoAssign.polledAt.set(key, startedAt);
  }
}

function labelsToPoll(
  context: TickContext,
): Array<{ connection: TrackerConnectionId; labelId: LabelId }> {
  const { db, logger } = context;
  let connections: TrackerConnectionId[];
  try {
    connections = context.adapters.trackerConnectionIds(db);
  } catch (error) {
    logger.warn("could not read tracker connections", { error });
    return [];
  }
  const workspaces = listWorkspaces(db);
  const seen = new Set<string>();
  const result: Array<{ connection: TrackerConnectionId; labelId: LabelId }> = [];
  for (const connection of connections) {
    for (const workspace of workspaces) {
      const labelId = getAutoAssignLabel(db, workspace.id, connection);
      if (labelId === null) continue;
      const key = `${connection}\n${labelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ connection, labelId });
    }
  }
  return result;
}

function trackerFor(context: TickContext, connection: TrackerConnectionId) {
  try {
    return context.adapters.tracker(context.db, connection);
  } catch (error) {
    context.logger.warn("could not create tracker adapter", { connection, error });
    return null;
  }
}

function assignForPolledTicket(
  context: TickContext,
  connection: TrackerConnectionId,
  labelId: LabelId,
  ticket: TrackerTicket,
): void {
  if (ticket.project === null) return;
  const target = autoAssignTarget(context, connection, ticket.project.id);
  if (target === null || target.labelId !== labelId) return;

  const ref: TicketRef = { connection, key: ticket.key };
  const runs = listRuns(context.db, { ticket: ref });
  if (runs.length > 0) return;
  const check = checkAutoAssignment({
    labelIds: ticket.labels.map((label) => label.id),
    autoAssignLabelId: labelId,
    labelAttachedAt: null,
    ticket: ref,
    runs: runs.map(toAutoAssignmentRun),
  });
  if (!check.ok) return;
  assign(context, ref, ticket.project.id, target.mapping);
}

function autoAssignTarget(
  context: TickContext,
  connection: TrackerConnectionId,
  trackerProject: TrackerProjectId,
): { labelId: LabelId; mapping: StoredMapping } | null {
  const { db } = context;
  const project = getWorkspaceTrackerProject(db, connection, trackerProject);
  if (project === null) return null;
  const labelId = getAutoAssignLabel(db, project.workspaceId, connection);
  if (labelId === null) return null;
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) return null;
  return { labelId, mapping };
}

function assign(
  context: TickContext,
  ticket: TicketRef,
  trackerProject: TrackerProjectId,
  mapping: StoredMapping,
): void {
  const result = assignRun(context.db, {
    ticket,
    trackerProject,
    runnerProject: mapping.runnerProject,
    agent: mapping.agent,
    model: mapping.model,
    now: context.now(),
  });
  if (!result.ok && result.reason !== "active-run") {
    context.logger.warn("could not assign ticket automatically", {
      ticketKey: ticket.key,
      reason: result.reason,
    });
  }
}

function toAutoAssignmentRun(run: StoredRun): AutoAssignmentRun {
  return {
    ticket: run.ticket,
    state: run.state,
    assignedAt: run.assignedAt,
    agentResult: run.state === "ended" ? run.agentResult : null,
    endedAt: run.state === "ended" ? run.endedAt : null,
  };
}
