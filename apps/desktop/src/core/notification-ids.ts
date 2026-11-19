import { createHash } from "node:crypto";

export function serverKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

export function notificationId(url: string, id: string): string {
  return `ganger:${serverKey(url)}:${id}`;
}

export function staleNotificationIds(
  url: string,
  delivered: ReadonlyArray<string>,
  open: ReadonlyArray<number>,
  shownNow: ReadonlySet<string>,
): string[] {
  const prefix = notificationId(url, "");
  const stillOpen = new Set(open.map((id) => notificationId(url, `event-${id}`)));
  return delivered.filter((id) => {
    if (!id.startsWith(prefix) || shownNow.has(id)) return false;
    const local = id.slice(prefix.length);
    if (local.startsWith("event-")) return !stillOpen.has(id);
    return local.startsWith("bundle-") || local.startsWith("missed-");
  });
}
