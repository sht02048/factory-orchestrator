import type { TrackerConnectionId } from "@ganger/core";
import { eq, sql } from "drizzle-orm";
import { recordSettingsChange } from "./change-events.js";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import { trackerWebhookReceipts } from "./schema.js";

export interface WebhookReceipt {
  lastReceivedAt: Date | null;
  rejectedCount: number;
  firstRejectedAt: Date | null;
}

export const NO_WEBHOOK_RECEIPT: WebhookReceipt = {
  lastReceivedAt: null,
  rejectedCount: 0,
  firstRejectedAt: null,
};

export function recordWebhookAccepted(
  db: Database,
  connection: TrackerConnectionId,
  now: Date,
): void {
  inTransaction(db, () => {
    const before = getWebhookReceipt(db, connection);
    db.insert(trackerWebhookReceipts)
      .values({ trackerConnectionId: connection, lastReceivedAt: now })
      .onConflictDoUpdate({
        target: trackerWebhookReceipts.trackerConnectionId,
        set: { lastReceivedAt: now, rejectedCount: 0, firstRejectedAt: null },
      })
      .run();
    if (before.lastReceivedAt === null || before.rejectedCount > 0) {
      recordWebhookStateChange(db, connection, now);
    }
  });
}

export function recordWebhookBadSignature(
  db: Database,
  connection: TrackerConnectionId,
  now: Date,
): void {
  inTransaction(db, () => {
    db.insert(trackerWebhookReceipts)
      .values({ trackerConnectionId: connection, rejectedCount: 1, firstRejectedAt: now })
      .onConflictDoUpdate({
        target: trackerWebhookReceipts.trackerConnectionId,
        set: {
          rejectedCount: sql`${trackerWebhookReceipts.rejectedCount} + 1`,
          firstRejectedAt: sql`coalesce(${trackerWebhookReceipts.firstRejectedAt}, ${now.getTime()})`,
        },
      })
      .run();
    recordWebhookStateChange(db, connection, now);
  });
}

export function forgetWebhookReceipt(
  db: Database,
  connection: TrackerConnectionId,
  now: Date = new Date(),
): void {
  inTransaction(db, () => {
    const removed = db
      .delete(trackerWebhookReceipts)
      .where(eq(trackerWebhookReceipts.trackerConnectionId, connection))
      .run();
    if (removed.changes > 0) recordWebhookStateChange(db, connection, now);
  });
}

function recordWebhookStateChange(db: Database, connection: TrackerConnectionId, now: Date): void {
  recordSettingsChange(db, { targetId: connection, workspaceId: null }, now);
}

export function getWebhookReceipt(db: Database, connection: TrackerConnectionId): WebhookReceipt {
  const row = db
    .select({
      lastReceivedAt: trackerWebhookReceipts.lastReceivedAt,
      rejectedCount: trackerWebhookReceipts.rejectedCount,
      firstRejectedAt: trackerWebhookReceipts.firstRejectedAt,
    })
    .from(trackerWebhookReceipts)
    .where(eq(trackerWebhookReceipts.trackerConnectionId, connection))
    .get();
  return row ?? NO_WEBHOOK_RECEIPT;
}
