import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { startWebLog } from "./server/process-log";
import { guardRequest } from "./server/request-access";
import { serveRequest } from "./server/serve-request";
import { wakeWorker } from "./server/worker-wake";

if (import.meta.env.PROD) startWebLog(process.env);

export default createServerEntry({
  fetch: (request, opts) =>
    serveRequest(request, {
      guard: guardRequest,
      handle: (guarded) => handler.fetch(guarded, opts),
      wakeWorker,
    }),
});
