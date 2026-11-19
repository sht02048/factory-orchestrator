import type { AdapterRegistry, TrackerConnectionId, WebhookVerifyError } from "@ganger/core";
import { getTrackerConnection, markTrackerChanged, recordTrackerEvent } from "@ganger/db";
import type { Database, SecretBox } from "@ganger/db";

export const MAX_WEBHOOK_REQUEST_BYTES = 5 * 1024 * 1024;

export const WEBHOOK_BODY_TIMEOUT_MS = 5_000;

export interface WebhookLogger {
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const consoleWebhookLogger: WebhookLogger = {
  warn: (message, fields) => console.warn(`[web] ${message}`, fields ?? {}),
};

export interface WebhookContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
  logger: WebhookLogger;
  bodyTimeoutMs?: number;
}

export interface WebhookRequest {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export type WebhookOutcome =
  | "recorded"
  | "duplicate"
  | "unknown-connection"
  | "declared-too-large"
  | "body-timeout"
  | "body-aborted"
  | "internal-error"
  | WebhookVerifyError;

type WebhookReply = "recorded" | "duplicate" | "unauthorized" | "too-large" | "malformed" | "error";

const RESPONSE: Record<WebhookReply, number> = {
  recorded: 200,
  duplicate: 200,
  unauthorized: 401,
  "too-large": 413,
  malformed: 400,
  error: 500,
};

function replyFor(outcome: WebhookOutcome): WebhookReply {
  switch (outcome) {
    case "recorded":
    case "duplicate":
      return outcome;
    case "unknown-connection":
    case "bad-signature":
    case "stale-timestamp":
    case "body-too-large":
    case "body-timeout":
    case "body-aborted":
      return "unauthorized";
    case "declared-too-large":
      return "too-large";
    case "malformed":
      return "malformed";
    case "internal-error":
      return "error";
  }
}

export async function rejectTrackerWebhook(
  logger: WebhookLogger,
  connectionId: TrackerConnectionId,
  request: WebhookRequest,
  error: unknown,
): Promise<Response> {
  logger.warn("could not handle a tracker webhook", { connectionId, error });
  await cancelBody(request);
  return respond("error");
}

function respond(reply: WebhookReply): Response {
  return new Response(reply, {
    status: RESPONSE[reply],
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function receiveTrackerWebhook(
  context: WebhookContext,
  connectionId: TrackerConnectionId,
  request: WebhookRequest,
  now: Date,
): Promise<Response> {
  const outcome = await handle(context, connectionId, request, now);
  if (outcome !== "recorded" && outcome !== "duplicate" && outcome !== "internal-error") {
    context.logger.warn("rejected a tracker webhook", { connectionId, reason: outcome });
  }
  return respond(replyFor(outcome));
}

async function handle(
  context: WebhookContext,
  connectionId: TrackerConnectionId,
  request: WebhookRequest,
  now: Date,
): Promise<WebhookOutcome> {
  if (declaredLength(request) > MAX_WEBHOOK_REQUEST_BYTES) {
    await cancelBody(request);
    return "declared-too-large";
  }

  try {
    const connection = getTrackerConnection(context.db, context.secretBox, connectionId);
    if (connection === null) {
      await cancelBody(request);
      return "unknown-connection";
    }

    const read = await readBodyWithin(
      request,
      MAX_WEBHOOK_REQUEST_BYTES,
      context.bodyTimeoutMs ?? WEBHOOK_BODY_TIMEOUT_MS,
    );
    if (!read.ok) return BODY_OUTCOME[read.reason];

    const tracker = context.registry.createTracker(connection.kind, {
      config: connection.config,
      secrets: connection.secrets,
    });
    const result = tracker.verifyWebhook({
      rawBody: read.body,
      headers: Object.fromEntries(request.headers),
      now,
    });
    if (!result.ok) return result.error;
    const outcome = recordTrackerEvent(context.db, connection.id, result.event);
    if (outcome === "recorded") markTrackerChanged(context.db, connection.id);
    return outcome;
  } catch (error) {
    context.logger.warn("could not handle a tracker webhook", { connectionId, error });
    await cancelBody(request);
    return "internal-error";
  }
}

function declaredLength(request: WebhookRequest): number {
  const declared = request.headers.get("content-length")?.trim();
  return declared !== undefined && /^\d+$/.test(declared) ? Number(declared) : 0;
}

async function cancelBody(request: WebhookRequest): Promise<void> {
  if (request.body === null || request.body.locked) return;
  await request.body.cancel().catch(() => undefined);
}

export type BodyRead =
  | { ok: true; body: Uint8Array }
  | { ok: false; reason: "too-large" | "timeout" | "aborted" };

const BODY_OUTCOME: Record<"too-large" | "timeout" | "aborted", WebhookOutcome> = {
  "too-large": "body-too-large",
  timeout: "body-timeout",
  aborted: "body-aborted",
};

export async function readBodyWithin(
  request: WebhookRequest,
  limit: number,
  timeoutMs: number,
): Promise<BodyRead> {
  if (declaredLength(request) > limit) {
    await cancelBody(request);
    return { ok: false, reason: "too-large" };
  }
  if (request.body === null) return { ok: true, body: new Uint8Array() };

  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, timeoutMs);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return { ok: false, reason: timedOut ? "timeout" : "aborted" };
      }
      const { done, value } = chunk;
      if (timedOut) return { ok: false, reason: "timeout" };
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}
