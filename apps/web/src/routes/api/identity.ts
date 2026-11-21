import { getInstallSettings } from "@ganger/db";
import { createFileRoute } from "@tanstack/react-router";
import { identityOf } from "../../identity/identity";
import { getDatabase } from "../../server/database";
import { isRequestHostAllowed } from "../../server/request-access";

export const Route = createFileRoute("/api/identity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const allowed = await isRequestHostAllowed(request);
        const { instanceId } = getInstallSettings(getDatabase());
        return Response.json(identityOf(instanceId, allowed ? "allowed" : "host-not-allowed"), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
