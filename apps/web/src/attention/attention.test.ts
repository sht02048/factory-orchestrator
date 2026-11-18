import { toPermissionRequestId, toQuestionId } from "@factory/core";
import { answerRunQuestion, recordPermissionWaits, recordRunQuestions } from "@factory/db";
import { describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";
import { loadAttention } from "./attention";

/*
 * 알림할 사건(0046, Q4). 질문 대기·권한 대기·Human Check·러너 Offline 만 담고 Merged·Failed 는 담지 않는다.
 * 시드: ACME-2 는 Human Check, ACME-1 은 Merged, ACME-3~7 은 Failed, runner-b 는 Offline, ACME-11 은 입력 기다림.
 */
describe("알림할 사건", () => {
  it("Human Check 와 러너 Offline 만 담고 Merged·Failed 는 담지 않는다", () => {
    const { db } = seedDatabase();
    const events = loadAttention(db, now);
    expect(events.map((event) => event.kind).toSorted()).toEqual(["human-check", "runner-offline"]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "human-check", ticketKey: "ACME-2" }),
    );
    expect(events).toContainEqual({
      kind: "runner-offline",
      key: "runner-offline:runner-b",
      runnerId: "runner-b",
      runnerName: "runner-b",
    });
    for (const ticketKey of ["ACME-1", "ACME-3", "ACME-4", "ACME-5", "ACME-6", "ACME-7"]) {
      expect(events.some((event) => "ticketKey" in event && event.ticketKey === ticketKey)).toBe(
        false,
      );
    }
  });

  it("답하지 않은 질문을 담고, 답을 남기면 뺀다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    recordRunQuestions(db, runId, [
      { id: toQuestionId("q-1"), body: "어느 쪽으로 할까요?", options: [], askedAt: minutes(100) },
    ]);
    expect(loadAttention(db, now)).toContainEqual({
      kind: "question",
      key: "question:q-1",
      runId,
      ticketKey: "ACME-11",
    });

    answerRunQuestion(db, { runId, questionId: toQuestionId("q-1"), answer: "A" }, minutes(101));
    expect(loadAttention(db, now).some((event) => event.kind === "question")).toBe(false);
  });

  it("권한 대기를 담는다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    recordPermissionWaits(db, runId, [
      {
        id: toPermissionRequestId("apr-1"),
        detail: "Bash(touch notes.txt)",
        requestedAt: minutes(100),
      },
    ]);
    expect(loadAttention(db, now)).toContainEqual({
      kind: "permission",
      key: "permission:apr-1",
      runId,
      ticketKey: "ACME-11",
    });
  });
});
