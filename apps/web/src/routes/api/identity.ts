import { getInstallSettings } from "@ganger/db";
import { createFileRoute } from "@tanstack/react-router";
import { identityOf } from "../../identity/identity";
import { getDatabase } from "../../server/database";
import { currentAllowedHosts } from "../../server/request-access";
import { hostnameOfHostHeader, isHostAllowed } from "@ganger/app/request-guard";

export const Route = createFileRoute("/api/identity")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const { pathname } = new URL(request.url);
        const allowed = isHostAllowed(
          hostnameOfHostHeader(request.headers.get("host")),
          pathname,
          currentAllowedHosts(),
        );
        const { instanceId } = getInstallSettings(getDatabase());
        return Response.json(identityOf(instanceId, allowed ? "allowed" : "host-not-allowed"), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
