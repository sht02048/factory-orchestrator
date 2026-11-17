import { readFileSync } from "node:fs";
import { AdapterRegistry, toTrackerConnectionId } from "@factory/core";
import type { TrackerConnectionId } from "@factory/core";
import {
  SecretBox,
  listUnprocessedTrackerEvents,
  migrate,
  openDatabase,
  saveTrackerConnection,
} from "@factory/db";
import type { Database } from "@factory/db";
import { LINEAR_TRACKER_KIND, linearTrackerFactory } from "@factory/tracker-linear";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_WEBHOOK_REQUEST_BYTES, receiveTrackerWebhook } from "./receive";
import type { WebhookContext, WebhookRequest } from "./receive";

/**
 * research 0005 픽스처(0011이 받은 webhook 본문을 가상 값으로 바꾸고 `fixture-signing-secret`으로
 * 다시 서명한 것). 본문은 서명한 바이트 그대로 읽는다.
 */
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
/** 픽스처의 보낸 시각(본문 webhookTimestamp와 같다) 0.5초 뒤에 받은 것으로 한다. */
const receivedAt = new Date(Number(labelAdded.headers["linear-timestamp"]) + 500);

function setup(): WebhookContext {
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
  return { db, secretBox, registry: new AdapterRegistry().registerTracker(linearTrackerFactory) };
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

/** 끝없이 바이트를 내는 본문. 얼마나 읽혔는지와 끊겼는지를 센다. */
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
    expect(await response.text()).toBe("bad-signature");
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
    expect(await response.text()).toBe("stale-timestamp");
    expect(stored(context)).toEqual([]);
  });

  it("등록하지 않은 연결의 주소면 404로 응답하고 본문을 읽지 않는다", async () => {
    const context = setup();
    const { body, seen } = endlessBody(1024);

    const response = await send(context, toTrackerConnectionId("conn-missing"), {
      headers: new Headers(labelAdded.headers),
      body,
    });

    expect(response.status).toBe(404);
    expect(seen.pulled).toBeLessThanOrEqual(1024);
    expect(stored(context)).toEqual([]);
  });

  it("본문이 5MiB를 넘으면 읽는 도중에 끊고 413으로 응답하며 기록하지 않는다", async () => {
    const context = setup();
    const chunk = 64 * 1024;
    const { body, seen } = endlessBody(chunk);

    const response = await send(context, acme, { headers: new Headers(labelAdded.headers), body });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("body-too-large");
    expect(seen.canceled).toBe(true);
    // 상한을 넘긴 조각에서 멈춘다. 스트림이 미리 당겨 둔 조각 몇 개만 더 읽힐 수 있다.
    expect(seen.pulled).toBeLessThanOrEqual(MAX_WEBHOOK_REQUEST_BYTES + 4 * chunk);
    expect(stored(context)).toEqual([]);
  });

  it("Content-Length가 5MiB를 넘으면 본문을 읽지 않고 413으로 응답한다", async () => {
    const context = setup();
    const { body, seen } = endlessBody(1024);

    const response = await send(context, acme, {
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
  });

  it("상한과 같은 크기의 본문은 끊지 않고 검증으로 넘긴다", async () => {
    const context = setup();
    const padded = new Uint8Array(MAX_WEBHOOK_REQUEST_BYTES).fill(0x20);
    padded.set(labelAdded.rawBody);

    const response = await send(context, acme, request(padded, labelAdded.headers));

    // 공백을 덧붙여 서명이 맞지 않는다. 크기에서 막히지 않고 서명 검사까지 갔다는 뜻이다.
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("bad-signature");
  });
});
