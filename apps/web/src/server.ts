import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { guardRequest } from "./server/request-access";
import { serveRequest } from "./server/serve-request";
import { wakeWorker } from "./server/worker-wake";

export default createServerEntry({
  fetch: (request, opts) =>
    serveRequest(request, {
      guard: guardRequest,
      handle: (guarded) => handler.fetch(guarded, opts),
      wakeWorker,
    }),
});
