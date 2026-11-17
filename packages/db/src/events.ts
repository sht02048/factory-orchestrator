import type {
  DeliveryId,
  LabelId,
  TicketKey,
  TrackerConnectionId,
  TrackerEvent,
  TrackerProjectId,
} from "@factory/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { trackerEvents } from "./schema.js";

/**
 * 검증을 통과한 webhook 이벤트를 쓴다(0027). 같은 트래커 연결의 같은 중복 제거 키
 * (`Linear-Delivery`)가 이미 있으면 쓰지 않고 "duplicate"를 돌려준다(research 0002 B.2).
 */
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
  /** 이 이벤트로 라벨이 바뀌었으면 바뀌기 전 라벨 전부. core labelJustAttached로 본다 */
  previousLabelIds: LabelId[] | null;
  receivedAt: Date;
}

/** 아직 처리하지 않은 이벤트. 받은 순서다(0018). */
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
