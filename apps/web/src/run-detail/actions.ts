import { toQuestionId, toRunId } from "@factory/core";
import { answerRunQuestion, requestRunCancel } from "@factory/db";
import type { Database } from "@factory/db";

/*
 * Run 상세에서 운영자가 하는 행동. web 은 ssh 를 쓰지 않고 DB 에 요청만 남기며 worker 가 처리한다(Q61).
 * 결과는 화면이 다시 읽어 보인다. 실패 이유는 열거값으로 돌려준다.
 */

export type RunActionResult = { ok: true } | { ok: false; reason: string };

/**
 * 질문에 답한다(Q82.3). 질문 하나에 답은 하나다. 빈 답은 받지 않는다.
 * worker 가 답을 러너에 보내고 보냈다고 기록한다(0016).
 */
export function answerQuestion(
  db: Database,
  input: { runId: string; questionId: string; answer: string },
  now: Date,
): RunActionResult {
  const answer = input.answer.trim();
  if (answer === "") return { ok: false, reason: "empty" };
  return answerRunQuestion(
    db,
    { runId: toRunId(input.runId), questionId: toQuestionId(input.questionId), answer },
    now,
  );
}

/**
 * 런 취소를 요청한다(Q77·Q82.8). 끝나지 않은 런만 받는다. 이미 요청이 있으면 그 요청을 둔다.
 * worker 가 처리하기 전까지 화면은 "취소 중"을 보인다(Q82.21).
 */
export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}
