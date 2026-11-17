import {
  toDeliveryId,
  toLabelId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
} from "@factory/core";
import type {
  DeliveryId,
  LabelId,
  TicketKey,
  TrackerConnectionId,
  TrackerEvent,
  TrackerProjectId,
} from "@factory/core";
import { z } from "zod";
import type { Database } from "./database.js";

// ---------- webhook 이벤트 ----------

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
    .prepare(
      `INSERT INTO tracker_events
         (tracker_connection_id, delivery_id, kind, tracker_project_id, ticket_key, label_ids, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tracker_connection_id, delivery_id) DO NOTHING`,
    )
    .run(
      connection,
      event.deliveryId,
      event.kind,
      event.projectId,
      event.ticketKey,
      event.labelIds === null ? null : JSON.stringify(event.labelIds),
      event.receivedAt.getTime(),
    );
  return result.changes > 0 ? "recorded" : "duplicate";
}

export interface StoredTrackerEvent {
  connection: TrackerConnectionId;
  deliveryId: DeliveryId;
  kind: string;
  projectId: TrackerProjectId | null;
  ticketKey: TicketKey | null;
  labelIds: LabelId[] | null;
  receivedAt: Date;
}

const eventRow = z.object({
  tracker_connection_id: z.string().transform(toTrackerConnectionId),
  delivery_id: z.string().transform(toDeliveryId),
  kind: z.string(),
  tracker_project_id: z.string().transform(toTrackerProjectId).nullable(),
  ticket_key: z.string().transform(toTicketKey).nullable(),
  label_ids: z.string().nullable(),
  received_at: z.number().int(),
});

const labelIds = z.array(z.string().transform(toLabelId));

/** 아직 처리하지 않은 이벤트. 받은 순서다(0018). */
export function listUnprocessedTrackerEvents(db: Database): StoredTrackerEvent[] {
  return db
    .prepare("SELECT * FROM tracker_events WHERE processed_at IS NULL ORDER BY received_at, rowid")
    .all()
    .map((raw) => {
      const row = eventRow.parse(raw);
      return {
        connection: row.tracker_connection_id,
        deliveryId: row.delivery_id,
        kind: row.kind,
        projectId: row.tracker_project_id,
        ticketKey: row.ticket_key,
        labelIds: row.label_ids === null ? null : labelIds.parse(JSON.parse(row.label_ids)),
        receivedAt: new Date(row.received_at),
      };
    });
}

export function markTrackerEventProcessed(
  db: Database,
  connection: TrackerConnectionId,
  deliveryId: DeliveryId,
  now: Date = new Date(),
): boolean {
  return (
    db
      .prepare(
        `UPDATE tracker_events SET processed_at = ?
         WHERE tracker_connection_id = ? AND delivery_id = ? AND processed_at IS NULL`,
      )
      .run(now.getTime(), connection, deliveryId).changes > 0
  );
}
