import { NOTIFICATION_EVENT_KINDS } from "@ganger/db";
import type { StoredNotificationEvent } from "@ganger/db";
import { z } from "zod";

export const NOTIFICATION_FEED_PATH = "/api/notification-events";
export const NOTIFICATION_STREAM_PATH = "/api/notification-events/stream";

export const notificationRecordSchema = z.object({
  id: z.number().int().positive(),
  seq: z.number().int().positive(),
  kind: z.enum(NOTIFICATION_EVENT_KINDS),
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("run"),
      runId: z.string(),
      workspaceId: z.string(),
      ticketKey: z.string(),
    }),
    z.object({ kind: z.literal("runner"), runnerId: z.string() }),
  ]),
  subject: z.string(),
  detail: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const notificationReadySchema = z.object({
  cursor: z.number().int().nonnegative(),
  open: z.array(z.number().int().positive()),
});
export type NotificationReady = z.infer<typeof notificationReadySchema>;

export const notificationFeedSchema = notificationReadySchema.extend({
  events: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = notificationRecordSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

export function toNotificationRecord(event: StoredNotificationEvent): NotificationRecord {
  return {
    id: event.id,
    seq: event.seq,
    kind: event.kind,
    target: event.target,
    subject: event.subject,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
    resolvedAt: event.resolvedAt === null ? null : event.resolvedAt.toISOString(),
  };
}

export function parseAfter(value: string | null): number | null {
  if (value === null) return null;
  const parsed = z.coerce.number().int().nonnegative().safeParse(value.trim());
  return value.trim().length > 0 && parsed.success ? parsed.data : null;
}
