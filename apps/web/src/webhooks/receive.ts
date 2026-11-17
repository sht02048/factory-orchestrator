import type { AdapterRegistry, TrackerConnectionId, WebhookVerifyError } from "@factory/core";
import { getTrackerConnection, recordTrackerEvent } from "@factory/db";
import type { Database, SecretBox } from "@factory/db";

/**
 * 트래커 webhook 수신(0027, research 0002 B.2). 주소의 Tracker Connection을 찾아 그 연결의 어댑터로
 * 원문 바이트를 검증하고, 통과한 이벤트를 중복 제거 키와 함께 DB에 쓴 뒤 200으로 응답한다.
 * 할당은 worker가 한다(0018). 검증에 실패한 요청은 쓰지 않는다.
 *
 * 트래커가 5초 안에 200을 받지 못하면 실패로 보고 다시 보내므로(research 0002 B.2) 여기서는
 * 원격 호출 없이 검증과 DB 쓰기만 한다.
 */

/**
 * 읽을 본문의 상한. 넘으면 다 읽기 전에 끊는다. tracker-linear의 `MAX_WEBHOOK_BODY_BYTES`와 같은 값이고
 * (공식 SDK 기본값, research 0002 B.2), 어댑터는 받은 바이트로 한 번 더 잰다.
 */
export const MAX_WEBHOOK_REQUEST_BYTES = 5 * 1024 * 1024;

export interface WebhookContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

/** 실제 Request에서 쓰는 부분. 테스트는 스트림을 직접 넘긴다. */
export interface WebhookRequest {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export type WebhookOutcome = "recorded" | "duplicate" | "unknown-connection" | WebhookVerifyError;

const STATUS: Record<WebhookOutcome, number> = {
  recorded: 200,
  // 재전송이다. 다시 보내지 않게 200으로 답한다.
  duplicate: 200,
  "unknown-connection": 404,
  "bad-signature": 401,
  "stale-timestamp": 401,
  "body-too-large": 413,
  malformed: 400,
};

export async function receiveTrackerWebhook(
  context: WebhookContext,
  connectionId: TrackerConnectionId,
  request: WebhookRequest,
  now: Date,
): Promise<Response> {
  const outcome = await handle(context, connectionId, request, now);
  return new Response(outcome, {
    status: STATUS[outcome],
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handle(
  context: WebhookContext,
  connectionId: TrackerConnectionId,
  request: WebhookRequest,
  now: Date,
): Promise<WebhookOutcome> {
  const connection = getTrackerConnection(context.db, context.secretBox, connectionId);
  if (connection === null) return "unknown-connection";

  const rawBody = await readBodyWithin(request, MAX_WEBHOOK_REQUEST_BYTES);
  if (rawBody === null) return "body-too-large";

  const tracker = context.registry.createTracker(connection.kind, {
    config: connection.config,
    secrets: connection.secrets,
  });
  const result = tracker.verifyWebhook({
    rawBody,
    headers: Object.fromEntries(request.headers),
    now,
  });
  if (!result.ok) return result.error;
  return recordTrackerEvent(context.db, connection.id, result.event);
}

/**
 * 본문을 읽되 상한을 넘는 순간 스트림을 끊고 null을 돌려준다. 다 읽은 뒤에 재지 않는다.
 * 선언한 Content-Length가 이미 상한을 넘으면 읽지도 않는다.
 */
export async function readBodyWithin(
  request: WebhookRequest,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > limit) {
    await request.body?.cancel();
    return null;
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
