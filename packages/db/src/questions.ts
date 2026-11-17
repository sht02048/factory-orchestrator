import type { AgentQuestion, QuestionId, RunId } from "@factory/core";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "./database.js";
import { runQuestions } from "./schema.js";

/**
 * 에이전트 질문과 운영자 답(Q82.3·Q82.5). 러너는 메일을 소비하지 않고 읽으므로(같은 질문이 폴링마다 다시
 * 온다) 어떤 질문을 받았고 답했는지는 이 표가 기준이다.
 *
 * 흐름: worker가 폴링에서 본 질문을 쓴다(recordRunQuestions) → web이 운영자의 답을 남긴다(답 요청,
 * answerRunQuestion) → worker가 보낼 답을 꺼내(listUnsentAnswers) 러너에 보내고 한 번만 표시한다
 * (markAnswerSent) → 진행 판단은 보낸 질문을 거른다(sentQuestionIds, core resolveRunProgress).
 */
export interface StoredRunQuestion {
  runId: RunId;
  id: QuestionId;
  body: string;
  options: string[];
  askedAt: Date;
  answer: { text: string; answeredAt: Date; sentAt: Date | null } | null;
}

/** 폴링에서 본 질문을 쓴다. 이미 쓴 질문은 건드리지 않는다. 새로 쓴 수를 돌려준다. */
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

/**
 * 운영자가 질문에 답한다(web의 답 요청). 질문 하나에 답은 하나다. 이미 답했으면 바꾸지 않는다
 * (worker가 이미 보냈을 수 있다).
 */
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

/** 답을 남겼지만 아직 러너에 보내지 않은 질문. 답한 순서다(worker, 0016). */
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

/**
 * 답을 러너에 보냈다고 표시한다. 한 번만 참이다. 이미 표시했으면 false라 같은 답을 두 번 처리하지 않는다.
 */
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

/** 답을 보낸 질문. core resolveRunProgress의 `answered`에 넣는다. */
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

/** 런의 질문 전부. 받은 순서다(Run 상세 타임라인, 손댈 일). */
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
