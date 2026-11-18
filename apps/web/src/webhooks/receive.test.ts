import { readFileSync } from "node:fs";
import { AdapterRegistry, toTrackerConnectionId } from "@ganger/core";
import type { TrackerConnectionId } from "@ganger/core";
import {
  SecretBox,
  listUnprocessedTrackerEvents,
  migrate,
  openDatabase,
  saveTrackerConnection,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { LINEAR_TRACKER_KIND, linearTrackerFactory } from "@ganger/tracker-linear";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MAX_WEBHOOK_REQUEST_BYTES,
  WEBHOOK_BODY_TIMEOUT_MS,
  receiveTrackerWebhook,
  rejectTrackerWebhook,
} from "./receive";
import type { WebhookContext, WebhookLogger, WebhookRequest } from "./receive";

const FIXTURE_DIR = new URL("../../../../docs/research/fixtures/0005/", import.meta.url);
const SECRET = "fixture-signing-secret";

const acme = toTrackerConnectionId("conn-acme");
const other = toTrackerConnectionId("conn-other");

const headersSchema = z.record(z.string(), z.string());

function fixture(name: string): { rawBody: Uint8Array; headers: Record<string, string> } {
  const rawBody = new Uint8Array(readFileSync(new URL(`${name}.json`, FIXTURE_DIR)));
  const headers = headersSchema.parse(
    JSON.parse(readFileSync(new URL(`${name}.headers.json`, FIXTURE_DIR), "utf8")),
  );
  return { rawBody, headers };
}

const labelAdded = fixture("issue-update-label-added");
const receivedAt = new Date(Number(labelAdded.headers["linear-timestamp"]) + 500);

interface LogEntry {
  message: string;
  fields: Readonly<Record<string, unknown>>;
}

function memoryLogger(): WebhookLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, warn: (message, fields = {}) => entries.push({ message, fields }) };
}

const TEST_BODY_TIMEOUT_MS = 50;

function setup(): WebhookContext & { logger: ReturnType<typeof memoryLogger> } {
  const db: Database = openDatabase(":memory:");
  migrate(db);
  const secretBox = new SecretBox(new Uint8Array(32).fill(7));
  const save = (id: TrackerConnectionId, webhookSecret: string | null) => {
    saveTrackerConnection(db, secretBox, {
      id,
      kind: LINEAR_TRACKER_KIND,
      name: id,
      config: {},
      secrets: { apiKey: "lin_api_example", webhookSecret },
    });
  };
  save(acme, SECRET);
  save(other, "another-signing-secret");
  return {
    db,
    secretBox,
    registry: new AdapterRegistry().registerTracker(linearTrackerFactory),
    logger: memoryLogger(),
    bodyTimeoutMs: TEST_BODY_TIMEOUT_MS,
  };
}

function request(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  chunkBytes = 64 * 1024,
): WebhookRequest {
  let offset = 0;
  return {
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= rawBody.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(rawBody.slice(offset, offset + chunkBytes));
        offset += chunkBytes;
      },
    }),
  };
}

function endlessBody(chunkBytes: number) {
  const seen = { pulled: 0, canceled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulled += chunkBytes;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
    cancel() {
      seen.canceled = true;
    },
  });
  return { body, seen };
}

function tricklingBody(intervalMs: number) {
  const seen = { pulled: 0, canceled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        seen.pulled += 1;
        controller.enqueue(new Uint8Array([0x20]));
      },
      cancel() {
        seen.canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

function silentBody() {
  const seen = { canceled: false };
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel() {
      seen.canceled = true;
    },
  });
  return { body, seen };
}

function send(
  context: WebhookContext,
  connection: TrackerConnectionId,
  req: WebhookRequest,
  now = receivedAt,
): Promise<Response> {
  return receiveTrackerWebhook(context, connection, req, now);
}

function stored(context: WebhookContext) {
  return listUnprocessedTrackerEvents(context.db);
}

describe("receiveTrackerWebhook", () => {
  it("서명이 맞는 픽스처를 하나 기록하고 200으로 응답한다", async () => {
    const context = setup();

    const response = await send(context, acme, request(labelAdded.rawBody, labelAdded.headers));

    expect(response.status).toBe(200);
    expect(stored(context)).toEqual([
      {
        connection: acme,
        deliveryId: "00000000-0000-4000-8000-000000000008",
        kind: "ticket.updated",
        projectId: null,
        ticketKey: "ENG-123",
        labelIds: ["00000000-0000-4000-8000-000000000004"],
        previousLabelIds: [],
        receivedAt,
      },
    ]);
  });

  it("같은 Linear-Delivery가 다시 오면 200으로 응답하고 다시 쓰지 않는다", async () => {
    const context = setup();

    const first = await send(context, acme, request(labelAdded.rawBody, labelAdded.headers));
    const second = await send(
      context,
      acme,
      request(labelAdded.rawBody, labelAdded.headers),
      new Date(receivedAt.getTime() + 1000),
    );

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.text()).toBe("duplicate");
    expect(stored(context)).toHaveLength(1);
  });

  it("본문이 바뀌어 서명이 틀리면 401로 응답하고 기록하지 않는다", async () => {
    const context = setup();
    const tampered = new TextEncoder().encode(
      new TextDecoder().decode(labelAdded.rawBody).replace("ENG-123", "ENG-124"),
    );

    const response = await send(context, acme, request(tampered, labelAdded.headers));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
    expect(context.logger.entries).toEqual([
      {
        message: "rejected a tracker webhook",
        fields: { connectionId: acme, reason: "bad-signature" },
      },
    ]);
    expect(stored(context)).toEqual([]);
  });

  it("주소의 연결이 가진 signing secret으로 검증한다", async () => {
    const context = setup();

    const wrongConnection = await send(
      context,
      other,
      request(labelAdded.rawBody, labelAdded.headers),
    );

    expect(wrongConnection.status).toBe(401);
    expect(stored(context)).toEqual([]);
  });

  it("signing secret이 아직 없는 연결은 어떤 요청도 받지 않는다", async () => {
    const context = setup();
    saveTrackerConnection(context.db, context.secretBox, {
      id: acme,
      kind: LINEAR_TRACKER_KIND,
      name: "acme",
      config: {},
      secrets: { apiKey: "lin_api_example" },
    });

    const response = await send(context, acme, request(labelAdded.rawBody, labelAdded.headers));

    expect(response.status).toBe(401);
    expect(stored(context)).toEqual([]);
  });

  it("보낸 시각이 1분보다 멀면 401로 응답하고 기록하지 않는다", async () => {
    const context = setup();

    const response = await send(
      context,
      acme,
      request(labelAdded.rawBody, labelAdded.headers),
      new Date(receivedAt.getTime() + 61_000),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual([
      "stale-timestamp",
    ]);
    expect(stored(context)).toEqual([]);
  });

  it("등록하지 않은 연결의 주소면 본문을 읽지 않고 끊은 뒤 401로 응답하고 이유를 기록한다", async () => {
    const context = setup();
    const { body, seen } = endlessBody(1024);
    const missing = toTrackerConnectionId("conn-missing");

    const response = await send(context, missing, {
      headers: new Headers(labelAdded.headers),
      body,
    });

    expect(response.status).toBe(401);
    expect(seen.canceled).toBe(true);
    expect(seen.pulled).toBeLessThanOrEqual(1024);
    expect(context.logger.entries).toEqual([
      {
        message: "rejected a tracker webhook",
        fields: { connectionId: missing, reason: "unknown-connection" },
      },
    ]);
    expect(stored(context)).toEqual([]);
  });

  it("없는 연결과 서명 실패는 바깥에서 같은 응답이다", async () => {
    const context = setup();
    const tampered = new TextEncoder().encode(
      new TextDecoder().decode(labelAdded.rawBody).replace("ENG-123", "ENG-124"),
    );

    const missing = await send(
      context,
      toTrackerConnectionId("conn-missing"),
      request(labelAdded.rawBody, labelAdded.headers),
    );
    const badSignature = await send(context, acme, request(tampered, labelAdded.headers));
    const stale = await send(
      context,
      acme,
      request(labelAdded.rawBody, labelAdded.headers),
      new Date(receivedAt.getTime() + 61_000),
    );

    const outside = async (response: Response) => ({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
    const expected = await outside(missing);
    expect(await outside(badSignature)).toEqual(expected);
    expect(await outside(stale)).toEqual(expected);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual([
      "unknown-connection",
      "bad-signature",
      "stale-timestamp",
    ]);
  });

  it("본문이 5MiB를 넘으면 읽는 도중에 끊고 401로 응답하며 이벤트를 쓰지 않는다", async () => {
    const context = setup();
    const chunk = 64 * 1024;
    const { body, seen } = endlessBody(chunk);

    const response = await send(context, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(401);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual([
      "body-too-large",
    ]);
    expect(seen.canceled).toBe(true);
    expect(seen.pulled).toBeLessThanOrEqual(MAX_WEBHOOK_REQUEST_BYTES + 4 * chunk);
    expect(stored(context)).toEqual([]);
  });

  it.each([
    ["등록한 연결", acme],
    ["없는 연결", toTrackerConnectionId("conn-missing")],
  ])(
    "Content-Length가 5MiB를 넘으면 본문을 읽지 않고 413으로 응답한다(%s)",
    async (_, connection) => {
      const context = setup();
      const { body, seen } = endlessBody(1024);

      const response = await send(context, connection, {
        headers: new Headers({
          ...labelAdded.headers,
          "content-length": String(MAX_WEBHOOK_REQUEST_BYTES + 1),
        }),
        body,
      });

      expect(response.status).toBe(413);
      expect(seen.canceled).toBe(true);
      expect(seen.pulled).toBeLessThanOrEqual(1024);
      expect(stored(context)).toEqual([]);
    },
  );

  it("상한과 같은 크기의 본문은 끊지 않고 검증으로 넘긴다", async () => {
    const context = setup();
    const padded = new Uint8Array(MAX_WEBHOOK_REQUEST_BYTES).fill(0x20);
    padded.set(labelAdded.rawBody);

    const response = await send(context, acme, request(padded, labelAdded.headers));

    expect(response.status).toBe(401);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual([
      "bad-signature",
    ]);
  });

  it("본문 시간 제한의 기본값은 트래커가 응답을 기다리는 5초다", () => {
    expect(WEBHOOK_BODY_TIMEOUT_MS).toBe(5_000);
  });

  it("본문을 조금씩 흘려 보내면 시간 제한에서 끊고 401로 응답한다", async () => {
    const context = setup();
    const { body, seen } = tricklingBody(5);
    const started = Date.now();

    const response = await send(context, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(401);
    expect(seen.canceled).toBe(true);
    expect(Date.now() - started).toBeLessThan(TEST_BODY_TIMEOUT_MS * 10);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual(["body-timeout"]);
    expect(stored(context)).toEqual([]);
  });

  it("본문 바이트를 보내지 않으면 시간 제한에서 끊고 401로 응답한다", async () => {
    const context = setup();
    const { body, seen } = silentBody();

    const response = await send(context, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(401);
    expect(seen.canceled).toBe(true);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual(["body-timeout"]);
  });

  it("보내는 쪽이 본문 도중에 끊으면 서버 오류가 아니라 401로 답하고 이유를 기록한다", async () => {
    const context = setup();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error("connection reset"));
          return;
        }
        sent = true;
        controller.enqueue(new Uint8Array([0x20]));
      },
    });

    const response = await send(context, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(401);
    expect(context.logger.entries.map((entry) => entry.fields["reason"])).toEqual(["body-aborted"]);
    expect(stored(context)).toEqual([]);
  });

  it("연결의 비밀값을 열지 못하면 기록하고 내용 없는 500으로 응답한다", async () => {
    const context = setup();
    const wrongKey = { ...context, secretBox: new SecretBox(new Uint8Array(32).fill(9)) };
    const { body, seen } = endlessBody(1024);

    const response = await send(wrongKey, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("error");
    expect(seen.canceled).toBe(true);
    expect(context.logger.entries.map((entry) => entry.message)).toEqual([
      "could not handle a tracker webhook",
    ]);
    expect(context.logger.entries[0]?.fields["error"]).toBeInstanceOf(Error);
    expect(stored(context)).toEqual([]);
  });

  it("연결 종류의 어댑터를 만들지 못하면 기록하고 내용 없는 500으로 응답한다", async () => {
    const context = setup();
    const noAdapters = { ...context, registry: new AdapterRegistry() };

    const response = await send(noAdapters, acme, request(labelAdded.rawBody, labelAdded.headers));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("error");
    expect(context.logger.entries.map((entry) => entry.message)).toEqual([
      "could not handle a tracker webhook",
    ]);
    expect(stored(context)).toEqual([]);
  });

  it("처리 전에 서버 설정 오류가 나면 기록하고 본문을 끊은 뒤 500으로 응답한다", async () => {
    const logger = memoryLogger();
    const { body, seen } = endlessBody(1024);
    const failure = new Error("bad boot config");

    const response = await rejectTrackerWebhook(
      logger,
      acme,
      { headers: new Headers(), body },
      failure,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("error");
    expect(seen.canceled).toBe(true);
    expect(logger.entries).toEqual([
      {
        message: "could not handle a tracker webhook",
        fields: { connectionId: acme, error: failure },
      },
    ]);
  });
});
