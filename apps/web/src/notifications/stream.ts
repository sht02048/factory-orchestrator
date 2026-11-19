import type { NotificationFeed, NotificationRecord } from "@ganger/app/notifications/feed";

export const STREAM_POLL_MS = 2_000;
export const STREAM_HEARTBEAT_MS = 15_000;
export const STREAM_RETRY_MS = 3_000;

export interface NotificationStreamOptions {
  after: number | null;
  sync: () => void;
  read: (after: number | null) => NotificationFeed;
  pollMs?: number;
  heartbeatMs?: number;
}

export function sseMessage(fields: { event?: string; id?: number; data: unknown }): string {
  const lines: string[] = [];
  if (fields.event !== undefined) lines.push(`event: ${fields.event}`);
  if (fields.id !== undefined) lines.push(`id: ${fields.id}`);
  lines.push(`data: ${JSON.stringify(fields.data)}`);
  return `${lines.join("\n")}\n\n`;
}

function recordMessage(record: NotificationRecord): string {
  return sseMessage({ event: "notification", id: record.seq, data: record });
}

export function notificationStream(options: NotificationStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pollMs = options.pollMs ?? STREAM_POLL_MS;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  let poll: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (poll !== undefined) clearInterval(poll);
    if (heartbeat !== undefined) clearInterval(heartbeat);
    poll = undefined;
    heartbeat = undefined;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): boolean => {
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          stop();
          return false;
        }
      };
      options.sync();
      const first = options.read(options.after);
      let cursor = first.cursor;
      send(`retry: ${STREAM_RETRY_MS}\n\n`);
      for (const record of first.events) send(recordMessage(record));
      send(sseMessage({ event: "ready", id: cursor, data: { cursor, open: first.open } }));
      poll = setInterval(() => {
        try {
          options.sync();
          const next = options.read(cursor);
          for (const record of next.events) {
            if (!send(recordMessage(record))) return;
          }
          cursor = next.cursor;
        } catch {
          send(`: error\n\n`);
        }
      }, pollMs);
      heartbeat = setInterval(() => send(`: ping\n\n`), heartbeatMs);
    },
    cancel() {
      stop();
    },
  });
}

export function notificationStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export function lastEventId(request: Request): string | null {
  const header = request.headers.get("last-event-id");
  if (header !== null) return header;
  return new URL(request.url).searchParams.get("after");
}
