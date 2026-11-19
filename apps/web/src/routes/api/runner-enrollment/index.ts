import { createFileRoute } from "@tanstack/react-router";
import { receiveRunnerEnrollment } from "../../../server/runner-enrollment-http";

export const Route = createFileRoute("/api/runner-enrollment/")({
  server: {
    handlers: {
      POST: ({ request }) => receiveRunnerEnrollment(request),
    },
  },
});
