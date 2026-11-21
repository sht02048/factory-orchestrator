import { randomUUID } from "node:crypto";
import { withLogContext } from "@ganger/log";
export interface ServeRequestOptions {
  guard(request: Request): Response | null | Promise<Response | null>;
  handle(request: Request): Response | Promise<Response>;
  wakeWorker(): void;
}

export async function serveRequest(
  request: Request,
  options: ServeRequestOptions,
): Promise<Response> {
  const rejected = await options.guard(request);
  if (rejected !== null) return rejected;
  const response = await withLogContext({ requestId: randomUUID() }, () => options.handle(request));
  if (request.method === "POST" && response.ok) options.wakeWorker();
  return response;
}
