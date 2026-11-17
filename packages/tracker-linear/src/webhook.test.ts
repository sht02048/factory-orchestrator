import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { labelJustAttached, toLabelId } from "@factory/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_WEBHOOK_BODY_BYTES, verifyLinearWebhook } from "./webhook.js";

/**
 * research 0005 픽스처(0011이 받은 webhook 본문을 가상 값으로 바꾸고 `fixture-signing-secret`으로 다시
 * 서명한 것). 본문은 서명한 바이트 그대로 읽는다.
 */
const FIXTURE_DIR = new URL("../../../docs/research/fixtures/0005/", import.meta.url);
const SECRET = "fixture-signing-secret";

const headersSchema = z.record(z.string(), z.string());

function fixture(name: string): { rawBody: Uint8Array; headers: Record<string, string> } {
  const rawBody = new Uint8Array(readFileSync(new URL(`${name}.json`, FIXTURE_DIR)));
  const headers = headersSchema.parse(
    JSON.parse(readFileSync(new URL(`${name}.headers.json`, FIXTURE_DIR), "utf8")),
  );
  return { rawBody, headers };
}

/** 픽스처의 보낸 시각(본문 webhookTimestamp와 같다) 0.5초 뒤에 받은 것으로 한다. */
function receivedSoonAfter(headers: Record<string, string>): Date {
  return new Date(Number(headers["linear-timestamp"]) + 500);
}

function sign(body: string | Uint8Array, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signedRequest(body: string, extra: Record<string, string> = {}) {
  return {
    rawBody: new TextEncoder().encode(body),
    headers: {
      "linear-delivery": "00000000-0000-4000-8000-000000000999",
      "linear-signature": sign(body),
      ...extra,
    },
  };
}

const AUTO_ASSIGN = toLabelId("00000000-0000-4000-8000-000000000004");
const BUG = toLabelId("00000000-0000-4000-8000-000000000011");
const NOW = new Date("2026-11-17T12:00:00.000Z");

describe("verifyLinearWebhook: 서명 성공", () => {
  it("라벨 추가 Issue update를 ticket.updated로 파싱하고 라벨이 방금 붙었다고 본다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const now = receivedSoonAfter(headers);

    const result = verifyLinearWebhook({ rawBody, headers, now, secret: SECRET });

    expect(result).toEqual({
      ok: true,
      event: {
        deliveryId: "00000000-0000-4000-8000-000000000008",
        kind: "ticket.updated",
        ticketKey: "ENG-123",
        projectId: null,
        labelIds: [AUTO_ASSIGN],
        previousLabelIds: [],
        receivedAt: now,
      },
    });
    if (!result.ok) return;
    expect(labelJustAttached(result.event, AUTO_ASSIGN)).toBe(true);
  });

  it("상태와 라벨을 한 번에 바꾼 update에서 이전 라벨 배열 전체를 돌려준다", () => {
    const { rawBody, headers } = fixture("issue-update-state-and-label");

    const result = verifyLinearWebhook({
      rawBody,
      headers,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.deliveryId).toBe("00000000-0000-4000-8000-000000000013");
    expect(result.event.labelIds).toEqual([AUTO_ASSIGN, BUG]);
    expect(result.event.previousLabelIds).toEqual([AUTO_ASSIGN]);
    expect(labelJustAttached(result.event, BUG)).toBe(true);
    // 이미 붙어 있던 라벨은 다시 붙은 것이 아니다.
    expect(labelJustAttached(result.event, AUTO_ASSIGN)).toBe(false);
  });

  it("티켓을 가리키지 않는 IssueLabel update는 other다", () => {
    const { rawBody, headers } = fixture("issuelabel-update-applied");

    const result = verifyLinearWebhook({
      rawBody,
      headers,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      kind: "other",
      ticketKey: null,
      projectId: null,
      labelIds: null,
      previousLabelIds: null,
    });
  });

  it("보관으로 온 Issue remove는 ticket.removed이고 라벨 변경이 아니다", () => {
    const { rawBody, headers } = fixture("issue-remove-archived");

    const result = verifyLinearWebhook({
      rawBody,
      headers,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      kind: "ticket.removed",
      ticketKey: "ENG-123",
      labelIds: [BUG, AUTO_ASSIGN],
      previousLabelIds: null,
    });
  });

  it("헤더 이름의 대소문자를 가리지 않는다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const upper = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => dash + c.toUpperCase()),
        value,
      ]),
    );

    const result = verifyLinearWebhook({
      rawBody,
      headers: upper,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
  });

  it("라벨을 단 채 만든 티켓은 라벨이 방금 붙은 것이다", () => {
    const req = signedRequest(
      JSON.stringify({
        action: "create",
        type: "Issue",
        webhookTimestamp: NOW.getTime(),
        data: { identifier: "ENG-7", projectId: "p-1", labelIds: [AUTO_ASSIGN] },
      }),
    );

    const result = verifyLinearWebhook({ ...req, now: NOW, secret: SECRET });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      kind: "ticket.created",
      ticketKey: "ENG-7",
      projectId: "p-1",
      previousLabelIds: [],
    });
    expect(labelJustAttached(result.event, AUTO_ASSIGN)).toBe(true);
  });

  it("updatedFrom.labelIds가 null이면 이전 라벨이 없던 것으로 본다", () => {
    const req = signedRequest(
      JSON.stringify({
        action: "update",
        type: "Issue",
        webhookTimestamp: NOW.getTime(),
        updatedFrom: { labelIds: null },
        data: { identifier: "ENG-7", labelIds: [AUTO_ASSIGN] },
      }),
    );

    const result = verifyLinearWebhook({ ...req, now: NOW, secret: SECRET });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.previousLabelIds).toEqual([]);
  });

  it("라벨이 바뀌지 않은 update는 previousLabelIds가 null이라 라벨이 남아 있어도 방금 붙지 않았다", () => {
    const req = signedRequest(
      JSON.stringify({
        action: "update",
        type: "Issue",
        webhookTimestamp: NOW.getTime(),
        updatedFrom: { title: "old" },
        data: { identifier: "ENG-7", labelIds: [AUTO_ASSIGN] },
      }),
    );

    const result = verifyLinearWebhook({ ...req, now: NOW, secret: SECRET });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.previousLabelIds).toBeNull();
    expect(labelJustAttached(result.event, AUTO_ASSIGN)).toBe(false);
  });
});

describe("verifyLinearWebhook: 서명 틀림", () => {
  it("본문을 한 바이트라도 바꾸면 거절한다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const tampered = new Uint8Array(rawBody);
    tampered[tampered.length - 2] = "8".charCodeAt(0);

    const result = verifyLinearWebhook({
      rawBody: tampered,
      headers,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "bad-signature" });
  });

  it("다른 signing secret이면 거절한다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");

    const result = verifyLinearWebhook({
      rawBody,
      headers,
      now: receivedSoonAfter(headers),
      secret: "other-secret",
    });

    expect(result).toEqual({ ok: false, error: "bad-signature" });
  });

  it.each([
    ["서명 헤더 없음", undefined],
    ["hex가 아님", "z".repeat(64)],
    ["길이가 다름", "ab"],
  ])("%s이면 거절한다", (_, signature) => {
    const { rawBody, headers } = fixture("issue-update-label-added");

    const result = verifyLinearWebhook({
      rawBody,
      headers: { ...headers, "linear-signature": signature },
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "bad-signature" });
  });

  it("signing secret이 없으면 어떤 요청도 거절한다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");

    const result = verifyLinearWebhook({
      rawBody,
      headers,
      now: receivedSoonAfter(headers),
      secret: null,
    });

    expect(result).toEqual({ ok: false, error: "bad-signature" });
  });
});

describe("verifyLinearWebhook: 오래된 타임스탬프", () => {
  it("보낸 지 1분이 지나면 거절한다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const sentAt = Number(headers["linear-timestamp"]);

    expect(
      verifyLinearWebhook({ rawBody, headers, now: new Date(sentAt + 60_001), secret: SECRET }),
    ).toEqual({ ok: false, error: "stale-timestamp" });
    expect(
      verifyLinearWebhook({ rawBody, headers, now: new Date(sentAt - 60_001), secret: SECRET }),
    ).toEqual({ ok: false, error: "stale-timestamp" });
    expect(
      verifyLinearWebhook({ rawBody, headers, now: new Date(sentAt + 60_000), secret: SECRET }).ok,
    ).toBe(true);
  });

  it("서명되지 않은 헤더 linear-timestamp가 아니라 본문 webhookTimestamp로 검사한다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const sentAt = Number(headers["linear-timestamp"]);
    const now = new Date(sentAt + 10 * 60_000);

    const result = verifyLinearWebhook({
      rawBody,
      headers: { ...headers, "linear-timestamp": String(now.getTime()) },
      now,
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "stale-timestamp" });
  });
});

describe("verifyLinearWebhook: 깨진 본문", () => {
  it.each([
    ["JSON이 아님", "not json"],
    ["webhookTimestamp 없음", JSON.stringify({ type: "Issue", action: "update", data: {} })],
    [
      "Issue인데 identifier 없음",
      JSON.stringify({
        type: "Issue",
        action: "update",
        webhookTimestamp: NOW.getTime(),
        data: {},
      }),
    ],
    [
      "updatedFrom.labelIds가 배열이 아님",
      JSON.stringify({
        type: "Issue",
        action: "update",
        webhookTimestamp: NOW.getTime(),
        updatedFrom: { labelIds: "x" },
        data: { identifier: "ENG-1" },
      }),
    ],
  ])("서명은 맞지만 %s이면 malformed다", (_, body) => {
    const result = verifyLinearWebhook({ ...signedRequest(body), now: NOW, secret: SECRET });

    expect(result).toEqual({ ok: false, error: "malformed" });
  });

  it("UTF-8이 아닌 바이트는 malformed다", () => {
    const rawBody = new Uint8Array([0x7b, 0xff, 0x7d]);

    const result = verifyLinearWebhook({
      rawBody,
      headers: { "linear-delivery": "d-1", "linear-signature": sign(rawBody) },
      now: NOW,
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "malformed" });
  });

  it("중복 제거 키 Linear-Delivery가 없으면 malformed다", () => {
    const { rawBody, headers } = fixture("issue-update-label-added");
    const { "linear-delivery": _, ...withoutDelivery } = headers;

    const result = verifyLinearWebhook({
      rawBody,
      headers: withoutDelivery,
      now: receivedSoonAfter(headers),
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "malformed" });
  });

  it("본문 크기 상한을 넘으면 서명을 보기 전에 거절한다", () => {
    const rawBody = new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1);

    const result = verifyLinearWebhook({
      rawBody,
      headers: { "linear-delivery": "d-1", "linear-signature": sign(rawBody) },
      now: NOW,
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, error: "body-too-large" });
  });
});
