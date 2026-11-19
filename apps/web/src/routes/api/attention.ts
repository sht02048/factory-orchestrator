import { createFileRoute } from "@tanstack/react-router";
import { legacyAlerts } from "../../notifications/notifications";
import { notificationSync } from "../../notifications/server";
import { getDatabase } from "../../server/database";

export const Route = createFileRoute("/api/attention")({
  server: {
    handlers: {
      GET: () => {
        notificationSync();
        return Response.json(
          { events: legacyAlerts(getDatabase()) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
