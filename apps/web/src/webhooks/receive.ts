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
 *
 * 이 주소는 Funnel 등으로 밖에 열린다(스펙 8절). 그래서(0040):
 * - 검증을 통과하지 못한 요청은 이유와 상관없이 같은 401로 답한다. 없는 연결, 서명 실패, 타임스탬프,
 *   읽는 도중 상한을 넘은 본문, 시간 안에 오지 않거나 도중에 끊긴 본문을 바깥에서 구별할 수 없게 해 연결 ID가 있는지
 *   드러내지 않는다. 이유는 안쪽 기록에 남긴다.
 * - 본문은 정해진 시간 안에 다 와야 한다. 아주 느리게 보내는 요청이 연결을 붙잡지 않게 한다.
 * - 연결 복호화·어댑터 설정 오류는 기록하고 일반 500으로 답한다. 오류 내용은 응답에 싣지 않는다.
 */

/**
 * 읽을 본문의 상한. 넘으면 다 읽기 전에 끊는다. tracker-linear의 `MAX_WEBHOOK_BODY_BYTES`와 같은 값이고
 * (공식 SDK 기본값, research 0002 B.2), 어댑터는 받은 바이트로 한 번 더 잰다.
 */
export const MAX_WEBHOOK_REQUEST_BYTES = 5 * 1024 * 1024;

/**
 * 본문을 다 읽는 데 주는 시간의 기본값(조각 하나가 아니라 본문 전체). 트래커는 5초 안에 200을 받지 못하면
 * 실패로 보고 다시 보내므로(research 0002 B.2) 그보다 오래 기다려 받은 본문은 쓸모가 없다. 정상 webhook
 * 본문은 수 KB라 한 번에 온다. `WebhookContext.bodyTimeoutMs`로 바꿀 수 있다.
 */
export const WEBHOOK_BODY_TIMEOUT_MS = 5_000;

/** webhook 수신이 남기는 기록. 바깥에는 같은 응답을 주고 이유는 여기에만 남긴다. */
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
  /** 본문을 다 읽는 데 주는 시간. 없으면 `WEBHOOK_BODY_TIMEOUT_MS`. */
  bodyTimeoutMs?: number;
}

/** 실제 Request에서 쓰는 부분. 테스트는 스트림을 직접 넘긴다. */
export interface WebhookRequest {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/** 안쪽 기록에 남기는 처리 결과. 응답은 `RESPONSE`로 몇 갈래로만 묶는다. */
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
  // 재전송이다. 다시 보내지 않게 200으로 답한다.
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
    // 검증 전에 막힌 요청. 바깥에서 이유를 구별할 수 없게 하나로 묶는다.
    case "unknown-connection":
    case "bad-signature":
    case "stale-timestamp":
    case "body-too-large":
    case "body-timeout":
    // 보내는 쪽이 끊었다. 서버 오류가 아니다.
    case "body-aborted":
      return "unauthorized";
    // 선언한 길이만 보고 연결을 찾기 전에 막는다. 연결이 있든 없든 같은 응답이다.
    case "declared-too-large":
      return "too-large";
    // 서명이 맞은 뒤에만 나온다. signing secret을 아는 쪽에만 보이는 응답이다.
    case "malformed":
      return "malformed";
    case "internal-error":
      return "error";
  }
}

/** 처리하기 전에 서버 쪽 오류가 났을 때. 기록하고 본문을 끊은 뒤 내용 없는 500으로 답한다. */
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
      // 본문은 읽지 않고 끊는다.
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
    return recordTrackerEvent(context.db, connection.id, result.event);
  } catch (error) {
    // 연결 복호화, 어댑터 설정, DB 쓰기 오류. 내용은 응답에 싣지 않고 기록에만 남긴다.
    context.logger.warn("could not handle a tracker webhook", { connectionId, error });
    await cancelBody(request);
    return "internal-error";
  }
}

/** 선언한 Content-Length. 없거나 숫자가 아니면 0으로 보고 읽으면서 잰다. */
function declaredLength(request: WebhookRequest): number {
  const declared = request.headers.get("content-length")?.trim();
  return declared !== undefined && /^\d+$/.test(declared) ? Number(declared) : 0;
}

/** 읽지 않을 본문을 끊는다. 이미 읽는 중이거나 끝난 스트림이면 아무것도 하지 않는다. */
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

/**
 * 본문을 읽되 상한을 넘거나 시간이 다 되는 순간 스트림을 끊는다. 다 읽은 뒤에 재지 않는다.
 * 시간은 조각마다가 아니라 본문 전체에 준다. 조금씩 흘려 보내도 시간이 늘지 않는다.
 * 선언한 Content-Length가 이미 상한을 넘으면 읽지도 않는다.
 */
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
  // 기다리던 read는 cancel로 done을 받고 풀린다.
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
        // 보내는 쪽이 연결을 끊었거나 스트림이 깨졌다.
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
