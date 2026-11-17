import { toPermissionRequestId, toQuestionId, toRunId } from "@factory/core";
import { answerRunQuestion, denyPermissionWait } from "@factory/db";
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

/** 운영자의 거절. 이유는 비어도 된다(에이전트가 대신 할 일, research 0008 deny --reason) */
export const denyInput = z.object({
  runId: z.string().min(1),
  promptId: z.string().min(1),
  reason: z.string().trim().max(10_000),
});

/** 권한 대기를 거절할 수 없음. 대기가 없거나, 이미 거절했거나, 러너에서 이미 닫혔다 */
export class DenyRejectedError extends Error {
  constructor(readonly reason: "not-found" | "already-denied" | "resolved") {
    super(`deny rejected: ${reason}`);
    this.name = "DenyRejectedError";
  }
}

/**
 * 권한 대기 거절을 남긴다(Q82.4). 허용은 없다. web 은 DB 에만 쓰고 worker 가 러너에 보낸다(Q61).
 */
export function submitDenial(db: Database, input: z.infer<typeof denyInput>, now: Date): void {
  const result = denyPermissionWait(
    db,
    {
      runId: toRunId(input.runId),
      permissionId: toPermissionRequestId(input.promptId),
      reason: input.reason,
    },
    now,
  );
  if (!result.ok) throw new DenyRejectedError(result.reason);
}
