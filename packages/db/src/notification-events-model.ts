export const NOTIFICATION_EVENT_KINDS = [
  "question",
  "permission",
  "human-check",
  "failed",
  "disconnected",
  "runner-offline",
  "runner-auth",
  "runner-usage-limit",
] as const;

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];
