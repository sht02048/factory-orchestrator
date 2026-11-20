import { toTrackerConnectionId } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { latestChangeSeq, listChangesAfter } from "./change-events.js";
import { connection, seededDatabase } from "./test-fixtures.js";
import {
  NO_WEBHOOK_RECEIPT,
  forgetWebhookReceipt,
  getWebhookReceipt,
  recordWebhookAccepted,
  recordWebhookBadSignature,
} from "./webhook-receipts.js";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 10, minute));

describe("webhook 수신 기록", () => {
  it("받은 적 없는 연결은 빈 기록이다", () => {
    expect(getWebhookReceipt(seededDatabase(), connection)).toEqual(NO_WEBHOOK_RECEIPT);
  });

  it("받으면 마지막으로 받은 때를 남긴다", () => {
    const db = seededDatabase();
    recordWebhookAccepted(db, connection, at(1));
    recordWebhookAccepted(db, connection, at(5));
    expect(getWebhookReceipt(db, connection)).toEqual({
      lastReceivedAt: at(5),
      rejectedCount: 0,
      firstRejectedAt: null,
    });
  });

  it("서명 실패는 수를 세고 처음 실패 시각을 지킨다", () => {
    const db = seededDatabase();
    recordWebhookAccepted(db, connection, at(1));
    recordWebhookBadSignature(db, connection, at(2));
    recordWebhookBadSignature(db, connection, at(3));
    recordWebhookBadSignature(db, connection, at(4));
    expect(getWebhookReceipt(db, connection)).toEqual({
      lastReceivedAt: at(1),
      rejectedCount: 3,
      firstRejectedAt: at(2),
    });
  });

  it("받은 적 없이 서명 실패만 있으면 마지막으로 받은 때는 비어 있다", () => {
    const db = seededDatabase();
    recordWebhookBadSignature(db, connection, at(2));
    expect(getWebhookReceipt(db, connection)).toEqual({
      lastReceivedAt: null,
      rejectedCount: 1,
      firstRejectedAt: at(2),
    });
  });

  it("실패 뒤에 받으면 실패 수와 처음 실패 시각을 지운다", () => {
    const db = seededDatabase();
    recordWebhookBadSignature(db, connection, at(2));
    recordWebhookAccepted(db, connection, at(6));
    recordWebhookBadSignature(db, connection, at(7));
    expect(getWebhookReceipt(db, connection)).toEqual({
      lastReceivedAt: at(6),
      rejectedCount: 1,
      firstRejectedAt: at(7),
    });
  });

  it("잊으면 그 연결의 기록만 지운다", () => {
    const db = seededDatabase();
    const other = toTrackerConnectionId("conn-2");
    recordWebhookAccepted(db, connection, at(1));
    forgetWebhookReceipt(db, connection);
    forgetWebhookReceipt(db, other);
    expect(getWebhookReceipt(db, connection)).toEqual(NO_WEBHOOK_RECEIPT);
  });

  it("보이는 상태가 바뀔 때만 이 연결의 settings 변경을 남긴다(0124)", () => {
    const db = seededDatabase();
    const changesAfter = (seq: number) =>
      listChangesAfter(db, seq).map((change) => [change.kind, change.targetId]);
    let seq = latestChangeSeq(db);
    recordWebhookAccepted(db, connection, at(1));
    expect(changesAfter(seq)).toEqual([["settings", connection]]);

    seq = latestChangeSeq(db);
    recordWebhookAccepted(db, connection, at(2));
    expect(changesAfter(seq)).toEqual([]);

    recordWebhookBadSignature(db, connection, at(3));
    expect(changesAfter(seq)).toEqual([["settings", connection]]);

    seq = latestChangeSeq(db);
    recordWebhookAccepted(db, connection, at(4));
    expect(changesAfter(seq)).toEqual([["settings", connection]]);

    seq = latestChangeSeq(db);
    forgetWebhookReceipt(db, connection, at(5));
    forgetWebhookReceipt(db, connection, at(6));
    expect(changesAfter(seq)).toEqual([["settings", connection]]);
  });
});
