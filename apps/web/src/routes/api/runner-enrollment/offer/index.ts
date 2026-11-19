import { createFileRoute } from "@tanstack/react-router";
import { serveEnrollmentOffer } from "../../../../server/runner-enrollment-http";

export const Route = createFileRoute("/api/runner-enrollment/offer/")({
  server: {
    handlers: {
      GET: () => serveEnrollmentOffer(),
    },
  },
});
