import { createFileRoute } from "@tanstack/react-router";
import { acceptRunnerEnrollmentOffer } from "../../../../server/runner-enrollment-http";

export const Route = createFileRoute("/api/runner-enrollment/offer/accept")({
  server: {
    handlers: {
      POST: ({ request }) => acceptRunnerEnrollmentOffer(request),
    },
  },
});
