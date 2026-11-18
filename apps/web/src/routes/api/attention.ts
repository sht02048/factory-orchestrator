import { createFileRoute } from "@tanstack/react-router";
import { loadAttention } from "../../attention/attention";
import { getDatabase } from "../../server/database";

export const Route = createFileRoute("/api/attention")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { events: loadAttention(getDatabase(), new Date()) },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
