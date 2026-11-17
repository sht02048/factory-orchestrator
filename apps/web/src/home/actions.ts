import { toQuestionId, toRunId } from "@factory/core";
import { answerRunQuestion } from "@factory/db";
import type { Database } from "@factory/db";
import { z } from "zod";

/** 운영자의 답. 러너에 ssh 인자로 보내므로 길이를 막는다(research 0008, reply 본문) */
export const answerInput = z.object({
  runId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(10_000),
});

/** 질문에 답할 수 없음. 질문이 없거나 이미 답했다 */
export class AnswerRejectedError extends Error {
  constructor(readonly reason: "not-found" | "already-answered") {
    super(`answer rejected: ${reason}`);
    this.name = "AnswerRejectedError";
  }
}

/**
 * 질문에 답을 남긴다(Q82.3). web 은 ssh 를 쓰지 않고 DB 에만 쓴다. worker 가 꺼내 러너에 보낸다(Q61).
 */
export function submitAnswer(db: Database, input: z.infer<typeof answerInput>, now: Date): void {
  const result = answerRunQuestion(
    db,
    {
      runId: toRunId(input.runId),
      questionId: toQuestionId(input.questionId),
      answer: input.answer,
    },
    now,
  );
  if (!result.ok) throw new AnswerRejectedError(result.reason);
}
