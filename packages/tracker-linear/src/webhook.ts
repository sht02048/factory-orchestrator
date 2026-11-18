import { createHmac, timingSafeEqual } from "node:crypto";
import { toDeliveryId, toLabelId, toTicketKey, toTrackerProjectId } from "@ganger/core";
import type { LabelId, TrackerEvent, WebhookVerifyError } from "@ganger/core";
import { z } from "zod";

export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;

export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 60_000;

const SIGNATURE_HEADER = "linear-signature";
const DELIVERY_HEADER = "linear-delivery";

export type WebhookResult =
  | { ok: true; event: TrackerEvent }
  | { ok: false; error: WebhookVerifyError };

const idSchema = z.string().min(1);

const envelopeSchema = z.object({
  type: z.string(),
  action: z.string(),
  webhookTimestamp: z.number(),
  data: z.unknown(),
  updatedFrom: z.record(z.string(), z.unknown()).nullish(),
});

const issueDataSchema = z.object({
  identifier: idSchema,
  projectId: idSchema.nullish(),
  labelIds: z.array(idSchema).nullish(),
});

const previousLabelIdsSchema = z.array(idSchema).nullable();

export function verifyLinearWebhook(input: {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
  now: Date;
  secret: string | null;
}): WebhookResult {
  if (input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, error: "body-too-large" };
  }

  const headers = lowerCaseKeys(input.headers);
  if (
    input.secret === null ||
    !signatureMatches(input.rawBody, headers[SIGNATURE_HEADER], input.secret)
  ) {
    return { ok: false, error: "bad-signature" };
  }

  const deliveryId = headers[DELIVERY_HEADER];
  if (deliveryId === undefined || deliveryId.length === 0) {
    return { ok: false, error: "malformed" };
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody));
  } catch {
    return { ok: false, error: "malformed" };
  }
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) return { ok: false, error: "malformed" };

  if (
    Math.abs(input.now.getTime() - envelope.data.webhookTimestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_MS
  ) {
    return { ok: false, error: "stale-timestamp" };
  }

  const base = { deliveryId: toDeliveryId(deliveryId), receivedAt: input.now };
  const kind = issueEventKind(envelope.data.type, envelope.data.action);
  if (kind === null) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "other",
        ticketKey: null,
        projectId: null,
        labelIds: null,
        previousLabelIds: null,
      },
    };
  }

  const issue = issueDataSchema.safeParse(envelope.data.data);
  if (!issue.success) return { ok: false, error: "malformed" };
  const labelIds = issue.data.labelIds?.map(toLabelId) ?? null;
  const previous = previousLabelIds(kind, envelope.data.updatedFrom ?? null);
  if (previous === "malformed") return { ok: false, error: "malformed" };

  return {
    ok: true,
    event: {
      ...base,
      kind,
      ticketKey: toTicketKey(issue.data.identifier),
      projectId:
        issue.data.projectId === null || issue.data.projectId === undefined
          ? null
          : toTrackerProjectId(issue.data.projectId),
      labelIds,
      previousLabelIds: previous,
    },
  };
}

function issueEventKind(
  type: string,
  action: string,
): "ticket.created" | "ticket.updated" | "ticket.removed" | null {
  if (type !== "Issue") return null;
  switch (action) {
    case "create":
      return "ticket.created";
    case "update":
      return "ticket.updated";
    case "remove":
      return "ticket.removed";
    default:
      return null;
  }
}

function previousLabelIds(
  kind: "ticket.created" | "ticket.updated" | "ticket.removed",
  updatedFrom: Readonly<Record<string, unknown>> | null,
): ReadonlyArray<LabelId> | null | "malformed" {
  switch (kind) {
    case "ticket.created":
      return [];
    case "ticket.removed":
      return null;
    case "ticket.updated": {
      if (updatedFrom === null || !Object.hasOwn(updatedFrom, "labelIds")) return null;
      const parsed = previousLabelIdsSchema.safeParse(updatedFrom["labelIds"]);
      if (!parsed.success) return "malformed";
      return parsed.data?.map(toLabelId) ?? [];
    }
  }
}

function lowerCaseKeys(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value;
  return result;
}

function signatureMatches(
  rawBody: Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined) return false;
  const trimmed = signature.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(trimmed, "hex"));
}
