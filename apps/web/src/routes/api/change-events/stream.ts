import { createFileRoute } from "@tanstack/react-router";
import { parseAfter } from "@ganger/app/notifications/feed";
import { changeStream } from "../../../change-events/feed";
import { lastEventId, notificationStreamResponse } from "../../../notifications/stream";
import { changeSourceOf, getChangeFeed } from "../../../server/change-events";
import { getDatabase } from "../../../server/database";

export const Route = createFileRoute("/api/change-events/stream")({
  server: {
    handlers: {
      GET: ({ request }) =>
        notificationStreamResponse(
          changeStream({
            after: parseAfter(lastEventId(request)),
            feed: getChangeFeed(),
            source: changeSourceOf(getDatabase()),
          }),
        ),
    },
  },
});
