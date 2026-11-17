import { toRunId } from "@factory/core";
import { requestRunCancel } from "@factory/db";
import type { Database } from "@factory/db";

/*
 * Run 상세에서 운영자가 하는 행동. web 은 ssh 를 쓰지 않고 DB 에 요청만 남기며 worker 가 처리한다(Q61).
 * 결과는 화면이 다시 읽어 보인다. 질문 답과 권한 거절은 홈과 같은 home/actions 를 쓴다.
 */

export type RunActionResult = { ok: true } | { ok: false; reason: string };

/**
 * 런 취소를 요청한다(Q77·Q82.8). 끝나지 않은 런만 받는다. 이미 요청이 있으면 그 요청을 둔다.
 * worker 가 처리하기 전까지 화면은 "취소 중"을 보인다(Q82.21).
 */
export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}
