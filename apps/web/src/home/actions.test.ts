import { toQuestionId } from "@factory/core";
import { listRunQuestions, recordRunQuestions } from "@factory/db";
import { describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";
import { AnswerRejectedError, answerInput, submitAnswer } from "./actions";

function seedQuestion() {
  const { db, ids } = seedDatabase();
  const runId = ids.get("ACME-11");
  if (runId === undefined) throw new Error("ACME-11 missing");
  recordRunQuestions(db, runId, [
    {
      id: toQuestionId("q-1"),
      body: "어느 쪽으로 할까요?",
      options: ["A", "B"],
      askedAt: minutes(100),
    },
  ]);
  return { db, runId };
}

describe("submitAnswer", () => {
  it("질문으로 기다리는 런에 답하면 DB 에 답이 하나 생긴다(Q82.3)", () => {
    const { db, runId } = seedQuestion();
    submitAnswer(db, answerInput.parse({ runId, questionId: "q-1", answer: " B " }), now);
    const answers = listRunQuestions(db, runId).flatMap((q) =>
      q.answer === null ? [] : [q.answer],
    );
    expect(answers).toEqual([{ text: "B", answeredAt: now, sentAt: null }]);
  });

  it("이미 답한 질문과 없는 질문은 거부한다", () => {
    const { db, runId } = seedQuestion();
    submitAnswer(db, { runId, questionId: "q-1", answer: "A" }, now);
    expect(() => submitAnswer(db, { runId, questionId: "q-1", answer: "B" }, now)).toThrow(
      new AnswerRejectedError("already-answered"),
    );
    expect(() => submitAnswer(db, { runId, questionId: "q-9", answer: "B" }, now)).toThrow(
      new AnswerRejectedError("not-found"),
    );
    expect(listRunQuestions(db, runId)[0]?.answer?.text).toBe("A");
  });

  it("빈 답은 받지 않는다", () => {
    expect(answerInput.safeParse({ runId: "r", questionId: "q", answer: "  " }).success).toBe(
      false,
    );
  });
});
