import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { guardRequest } from "./server/request-access";

export default createServerEntry({
  fetch(request, opts) {
    return guardRequest(request) ?? handler.fetch(request, opts);
  },
});
