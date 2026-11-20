import { createFileRoute } from "@tanstack/react-router";
import { diagnosticsRequest } from "@ganger/app/diagnostics/model";
import { makeDiagnostics } from "../../server/log-settings";

export const Route = createFileRoute("/api/diagnostics")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const bundle = makeDiagnostics(
          process.env,
          diagnosticsRequest(new URL(request.url)),
          new Date(),
        );
        return new Response(new Uint8Array(bundle.zip), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${bundle.name}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
