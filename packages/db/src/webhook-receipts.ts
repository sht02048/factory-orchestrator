import type { TrackerConnectionId } from "@ganger/core";
import { eq, sql } from "drizzle-orm";
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
  db.insert(trackerWebhookReceipts)
    .values({ trackerConnectionId: connection, lastReceivedAt: now })
    .onConflictDoUpdate({
      target: trackerWebhookReceipts.trackerConnectionId,
      set: { lastReceivedAt: now, rejectedCount: 0, firstRejectedAt: null },
    })
    .run();
}

export function recordWebhookBadSignature(
  db: Database,
  connection: TrackerConnectionId,
  now: Date,
): void {
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
}

export function forgetWebhookReceipt(db: Database, connection: TrackerConnectionId): void {
  db.delete(trackerWebhookReceipts)
    .where(eq(trackerWebhookReceipts.trackerConnectionId, connection))
    .run();
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
