import { toTrackerConnectionId } from "@factory/core";
import { createFileRoute } from "@tanstack/react-router";
import { getAdapterRegistry, getSecretBox } from "../../../../server/adapters";
import { getDatabase } from "../../../../server/database";
import {
  consoleWebhookLogger,
  receiveTrackerWebhook,
  rejectTrackerWebhook,
} from "../../../../webhooks/receive";
import type { WebhookContext } from "../../../../webhooks/receive";

export const Route = createFileRoute("/api/webhooks/tracker/$connectionId")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const now = new Date();
        const connectionId = toTrackerConnectionId(params.connectionId);
        let context: WebhookContext;
        try {
          context = {
            db: getDatabase(),
            secretBox: getSecretBox(),
            registry: getAdapterRegistry(),
            logger: consoleWebhookLogger,
          };
        } catch (error) {
          return rejectTrackerWebhook(consoleWebhookLogger, connectionId, request, error);
        }
        return receiveTrackerWebhook(context, connectionId, request, now);
      },
    },
  },
});
