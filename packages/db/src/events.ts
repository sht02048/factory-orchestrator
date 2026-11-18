import type {
  DeliveryId,
  LabelId,
  TicketKey,
  TrackerConnectionId,
  TrackerEvent,
  TrackerProjectId,
} from "@ganger/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { trackerEvents } from "./schema.js";

export function recordTrackerEvent(
  db: Database,
  connection: TrackerConnectionId,
  event: TrackerEvent,
): "recorded" | "duplicate" {
  const result = db
    .insert(trackerEvents)
    .values({
      trackerConnectionId: connection,
      deliveryId: event.deliveryId,
      kind: event.kind,
      trackerProjectId: event.projectId,
      ticketKey: event.ticketKey,
      labelIds: event.labelIds === null ? null : [...event.labelIds],
      previousLabelIds: event.previousLabelIds === null ? null : [...event.previousLabelIds],
      receivedAt: event.receivedAt,
    })
    .onConflictDoNothing({ target: [trackerEvents.trackerConnectionId, trackerEvents.deliveryId] })
    .run();
  return result.changes > 0 ? "recorded" : "duplicate";
}

export interface StoredTrackerEvent {
  connection: TrackerConnectionId;
  deliveryId: DeliveryId;
  kind: string;
  projectId: TrackerProjectId | null;
  ticketKey: TicketKey | null;
  labelIds: LabelId[] | null;
  previousLabelIds: LabelId[] | null;
  receivedAt: Date;
}

export function listUnprocessedTrackerEvents(db: Database): StoredTrackerEvent[] {
  return db
    .select({
      connection: trackerEvents.trackerConnectionId,
      deliveryId: trackerEvents.deliveryId,
      kind: trackerEvents.kind,
      projectId: trackerEvents.trackerProjectId,
      ticketKey: trackerEvents.ticketKey,
      labelIds: trackerEvents.labelIds,
      previousLabelIds: trackerEvents.previousLabelIds,
      receivedAt: trackerEvents.receivedAt,
    })
    .from(trackerEvents)
    .where(isNull(trackerEvents.processedAt))
    .orderBy(asc(trackerEvents.receivedAt), asc(trackerEvents.deliveryId))
    .all();
}

export function markTrackerEventProcessed(
  db: Database,
  connection: TrackerConnectionId,
  deliveryId: DeliveryId,
  now: Date = new Date(),
): boolean {
  return (
    db
      .update(trackerEvents)
      .set({ processedAt: now })
      .where(
        and(
          eq(trackerEvents.trackerConnectionId, connection),
          eq(trackerEvents.deliveryId, deliveryId),
          isNull(trackerEvents.processedAt),
        ),
      )
      .run().changes > 0
  );
}
