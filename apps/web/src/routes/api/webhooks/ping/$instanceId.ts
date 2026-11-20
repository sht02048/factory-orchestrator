import { getInstallSettings } from "@ganger/db";
import { createFileRoute } from "@tanstack/react-router";
import { webhookPingAnswer } from "@ganger/app/webhook-address";
import { getDatabase } from "../../../../server/database";

export const Route = createFileRoute("/api/webhooks/ping/$instanceId")({
  server: {
    handlers: {
      GET: ({ params }) =>
        webhookPingAnswer(getInstallSettings(getDatabase()).instanceId, params.instanceId),
    },
  },
});
