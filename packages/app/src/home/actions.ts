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

export const HUMAN_CHECK_DECISIONS = ["confirmed", "changes-requested"] as const;

export type HumanCheckDecision = (typeof HUMAN_CHECK_DECISIONS)[number];

const HUMAN_CHECK_ANSWER_WORDS: Record<HumanCheckDecision, string> = {
  confirmed: "확인했어요",
  "changes-requested": "고쳐 주세요",
};

export const humanCheckAnswerInput = z.object({
  runId: z.string().min(1),
  questionId: z.string().min(1),
  decision: z.enum(HUMAN_CHECK_DECISIONS),
  note: z.string().trim().max(10_000),
});

export function humanCheckAnswerText(decision: HumanCheckDecision, note: string): string {
  const words = HUMAN_CHECK_ANSWER_WORDS[decision];
  return note === "" ? words : `${words}\n\n${note}`;
}

export function submitHumanCheckAnswer(
  db: Database,
  input: z.infer<typeof humanCheckAnswerInput>,
  now: Date,
): void {
  const result = answerRunQuestion(
    db,
    {
      runId: toRunId(input.runId),
      questionId: toQuestionId(input.questionId),
      answer: humanCheckAnswerText(input.decision, input.note),
      kind: "human-check",
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
