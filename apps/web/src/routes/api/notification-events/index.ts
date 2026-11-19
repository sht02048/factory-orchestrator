import { createFileRoute } from "@tanstack/react-router";
import { parseAfter } from "@ganger/app/notifications/feed";
import { readNotificationFeed } from "../../../notifications/notifications";
import { notificationSync } from "../../../notifications/server";
import { getDatabase } from "../../../server/database";

export const Route = createFileRoute("/api/notification-events/")({
  server: {
    handlers: {
      GET: ({ request }) => {
        notificationSync();
        const after = parseAfter(new URL(request.url).searchParams.get("after"));
        return Response.json(readNotificationFeed(getDatabase(), after), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
