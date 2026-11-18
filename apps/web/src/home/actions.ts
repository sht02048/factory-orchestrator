import { toPermissionRequestId, toQuestionId, toRunId } from "@ganger/core";
import { answerRunQuestion, denyPermissionWait } from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";

export const answerInput = z.object({
  runId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(10_000),
});

export class AnswerRejectedError extends Error {
  constructor(readonly reason: "not-found" | "already-answered") {
    super(`answer rejected: ${reason}`);
    this.name = "AnswerRejectedError";
  }
}

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

export const denyInput = z.object({
  runId: z.string().min(1),
  promptId: z.string().min(1),
  reason: z.string().trim().max(10_000),
});

export class DenyRejectedError extends Error {
  constructor(readonly reason: "not-found" | "already-denied" | "resolved") {
    super(`deny rejected: ${reason}`);
    this.name = "DenyRejectedError";
  }
}

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
