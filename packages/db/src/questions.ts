import type { AgentQuestion, QuestionId, RunId } from "@ganger/core";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { runQuestions } from "./schema.js";

export interface StoredRunQuestion {
  runId: RunId;
  id: QuestionId;
  body: string;
  options: string[];
  askedAt: Date;
  answer: { text: string; answeredAt: Date; sentAt: Date | null } | null;
}

export function recordRunQuestions(
  db: Database,
  runId: RunId,
  questions: ReadonlyArray<AgentQuestion>,
): number {
  let recorded = 0;
  for (const question of questions) {
    recorded += Number(
      db
        .insert(runQuestions)
        .values({
          runId,
          questionId: question.id,
          body: question.body,
          options: [...question.options],
          askedAt: question.askedAt,
        })
        .onConflictDoNothing()
        .run().changes,
    );
  }
  return recorded;
}

export type AnswerRunQuestionResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-answered" };

export function answerRunQuestion(
  db: Database,
  input: { runId: RunId; questionId: QuestionId; answer: string },
  now: Date = new Date(),
): AnswerRunQuestionResult {
  const where = and(
    eq(runQuestions.runId, input.runId),
    eq(runQuestions.questionId, input.questionId),
  );
  const changed = db
    .update(runQuestions)
    .set({ answer: input.answer, answeredAt: now })
    .where(and(where, isNull(runQuestions.answer)))
    .run().changes;
  if (changed > 0) return { ok: true };
  const exists = db.select({ id: runQuestions.questionId }).from(runQuestions).where(where).get();
  return { ok: false, reason: exists === undefined ? "not-found" : "already-answered" };
}

export function listUnsentAnswers(
  db: Database,
): Array<{ runId: RunId; questionId: QuestionId; answer: string; answeredAt: Date }> {
  return db
    .select({
      runId: runQuestions.runId,
      questionId: runQuestions.questionId,
      answer: runQuestions.answer,
      answeredAt: runQuestions.answeredAt,
    })
    .from(runQuestions)
    .where(and(isNotNull(runQuestions.answer), isNull(runQuestions.answerSentAt)))
    .orderBy(asc(runQuestions.answeredAt), asc(runQuestions.questionId))
    .all()
    .flatMap((row) =>
      row.answer === null || row.answeredAt === null
        ? []
        : [{ ...row, answer: row.answer, answeredAt: row.answeredAt }],
    );
}

export function markAnswerSent(
  db: Database,
  input: { runId: RunId; questionId: QuestionId },
  now: Date = new Date(),
): boolean {
  return (
    db
      .update(runQuestions)
      .set({ answerSentAt: now })
      .where(
        and(
          eq(runQuestions.runId, input.runId),
          eq(runQuestions.questionId, input.questionId),
          isNotNull(runQuestions.answer),
          isNull(runQuestions.answerSentAt),
        ),
      )
      .run().changes > 0
  );
}

export function sentQuestionIds(db: Database, runId: RunId): Set<QuestionId> {
  return new Set(
    db
      .select({ id: runQuestions.questionId })
      .from(runQuestions)
      .where(and(eq(runQuestions.runId, runId), isNotNull(runQuestions.answerSentAt)))
      .all()
      .map((row) => row.id),
  );
}

export function listRunQuestions(db: Database, runId: RunId): StoredRunQuestion[] {
  return db
    .select()
    .from(runQuestions)
    .where(eq(runQuestions.runId, runId))
    .orderBy(asc(runQuestions.askedAt), asc(runQuestions.questionId))
    .all()
    .map((row) => ({
      runId: row.runId,
      id: row.questionId,
      body: row.body,
      options: row.options,
      askedAt: row.askedAt,
      answer:
        row.answer === null || row.answeredAt === null
          ? null
          : { text: row.answer, answeredAt: row.answeredAt, sentAt: row.answerSentAt },
    }));
}
