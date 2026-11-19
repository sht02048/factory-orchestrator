import { createFileRoute } from "@tanstack/react-router";
import { parseAfter } from "@ganger/app/notifications/feed";
import { readNotificationFeed } from "../../../notifications/notifications";
import { notificationSync } from "../../../notifications/server";
import {
  lastEventId,
  notificationStream,
  notificationStreamResponse,
} from "../../../notifications/stream";
import { getDatabase } from "../../../server/database";

export const Route = createFileRoute("/api/notification-events/stream")({
  server: {
    handlers: {
      GET: ({ request }) =>
        notificationStreamResponse(
          notificationStream({
            after: parseAfter(lastEventId(request)),
            sync: notificationSync,
            read: (after) => readNotificationFeed(getDatabase(), after),
          }),
        ),
    },
  },
});
