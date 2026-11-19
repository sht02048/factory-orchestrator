import { createFileRoute } from "@tanstack/react-router";
import { serveSetupScript } from "../../../server/runner-enrollment-http";

export const Route = createFileRoute("/api/runner-enrollment/script")({
  server: {
    handlers: {
      GET: ({ request }) => serveSetupScript(request),
    },
  },
});
