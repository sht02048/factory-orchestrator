import { createHmac, timingSafeEqual } from "node:crypto";
import { toDeliveryId, toLabelId, toTicketKey, toTrackerProjectId } from "@factory/core";
import type { LabelId, TrackerEvent, WebhookVerifyError } from "@factory/core";
import { z } from "zod";

/**
 * Linear webhook 검증과 이벤트 파싱(research 0002 B.2, research 0005 10·11절과 「설계에 주는 뜻」).
 *
 * 순서: 본문 크기 → 서명 → JSON 파싱 → 타임스탬프. 서명이 맞기 전에는 본문을 해석하지 않는다.
 * 검증에 실패한 요청은 이벤트가 되지 못한다.
 */

/** 본문 크기 상한. 공식 SDK(`@linear/sdk/webhooks`)의 기본값과 같다(research 0002 B.2). */
export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;

/** 보낸 시각과 받은 시각이 이보다 멀면 재전송으로 보고 거절한다(research 0002 B.2). */
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
  /** 보낸 시각(Unix ms). 서명이 덮는 본문 값이라 헤더 `linear-timestamp` 대신 이것으로 검사한다. */
  webhookTimestamp: z.number(),
  data: z.unknown(),
  updatedFrom: z.record(z.string(), z.unknown()).nullish(),
});

const issueDataSchema = z.object({
  identifier: idSchema,
  /** 트래커 프로젝트에 속하지 않은 티켓에서는 빠진다(research 0005 10절). */
  projectId: idSchema.nullish(),
  labelIds: z.array(idSchema).nullish(),
});

/** `updatedFrom.labelIds`. 이전에 값이 없었으면 null로 온다고 문서에 있다(research 0002 B.2). */
const previousLabelIdsSchema = z.array(idSchema).nullable();

export function verifyLinearWebhook(input: {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
  now: Date;
  /** webhook signing secret. 없으면 어떤 요청도 검증하지 못한다. */
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
    // 티켓을 가리키지 않는 이벤트(IssueLabel, Comment 등)는 할당 판단에 쓰지 않는다(research 0005 11절).
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
    // 보관(issueArchive)과 삭제는 본문으로 가르지 못한다. 둘 다 할당 대상이 아니게 됐다(research 0005 10절).
    case "remove":
      return "ticket.removed";
    default:
      return null;
  }
}

/**
 * 이 이벤트로 라벨이 바뀌었으면 바뀌기 전 라벨 전부, 아니면 null(core TrackerEvent.previousLabelIds).
 *
 * - update: `updatedFrom`에 `labelIds` 키가 있을 때만 라벨이 바뀌었다(research 0005 10절). 값은 차이가
 *   아니라 이전 배열 전체다. null(이전에 값이 없음)은 빈 배열로 본다.
 * - create: 라벨 없음에서 지금 라벨로 바뀐 것이라 빈 배열이다. 라벨을 단 채 만든 티켓도 "방금 붙었다"가 된다.
 * - remove: 라벨이 바뀐 것이 아니다.
 */
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

/** 원문 바이트의 HMAC-SHA256 hex와 `Linear-Signature`를 상수 시간으로 비교한다(research 0002 B.2). */
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
