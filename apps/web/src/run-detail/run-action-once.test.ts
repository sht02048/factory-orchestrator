import { AnswerRejectedError } from "@ganger/app/home/actions";
import {
  cancelRunOnce,
  continueRunOnce,
  controlRunOnce,
  removeWorktreeOnce,
  stopPreviousAgentOnce,
  submitAnswerOnce,
  submitHumanCheckOnce,
} from "@ganger/app/run-detail/actions";
import { toQuestionId, toTicketKey } from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  changeRunState,
  getRunControlRequest,
  listPendingCancelRequests,
  listRunQuestions,
  listRuns,
  recordAgentCheck,
  recordRunQuestions,
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { minutes, seedDatabase } from "../testing/seed";

const REQUEST = "request-id-0156-a";
const OTHER_REQUEST = "request-id-0156-b";
const FIRST = minutes(110);
const LATER = minutes(115);

function runningRun(db: Database): RunId {
  const run = listRuns(db, { states: ["running"] }).find(
    (candidate) => candidate.ticket.key === toTicketKey("ACME-10"),
  );
  if (run === undefined) throw new Error("no running run");
  return run.id;
}

function endedRun(db: Database, check: "gone" | "alive"): RunId {
  const id = runningRun(db);
  const ended = changeRunState(
    db,
    id,
    { to: "ended", agentResult: "reported-success", prState: "none" },
    minutes(105),
  );
  if (!ended.ok) throw new Error("state change failed");
  updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
  recordAgentCheck(db, id, check, { stopHandled: check === "gone" });
  return id;
}

function waitingRun(db: Database, kind: "question" | "human-check"): RunId {
  const id = runningRun(db);
  const waiting = changeRunState(db, id, { to: "waiting-for-input" }, minutes(105));
  if (!waiting.ok) throw new Error("state change failed");
  recordRunQuestions(db, id, [
    { id: toQuestionId("q-1"), kind, body: "확인해 주세요", options: [], askedAt: minutes(105) },
  ]);
  return id;
}

function answersOf(db: Database, runId: RunId) {
  return listRunQuestions(db, runId).map((question) => question.answer?.text ?? null);
}

function requestRows(db: Database, runId: RunId) {
  return db.$client
    .prepare("SELECT request_id FROM run_action_requests WHERE run_id = ?")
    .all(runId);
}

describe("같은 요청 ID는 한 번만 처리한다(0156)", () => {
  it("취소: 다시 보내도 요청은 하나이고 처음 시각을 지키며 같은 결과다", () => {
    const { db } = seedDatabase();
    const runId = runningRun(db);
    const key = { runId, requestId: REQUEST };

    expect(cancelRunOnce(db, key, FIRST)).toEqual({ ok: true });
    expect(cancelRunOnce(db, key, LATER)).toEqual({ ok: true });

    const requests = listPendingCancelRequests(db).filter((request) => request.runId === runId);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.requestedAt).toEqual(FIRST);
    expect(requestRows(db, runId)).toHaveLength(1);
  });

  it("워크트리 지우기: 처리된 뒤 다시 보내도 처음과 같은 성공이다", () => {
    const { db } = seedDatabase();
    const runId = endedRun(db, "gone");
    const key = { runId, requestId: REQUEST };

    expect(removeWorktreeOnce(db, key, FIRST)).toEqual({ ok: true });
    updateRunRecords(db, runId, { worktreeRemovedAt: minutes(112) });

    expect(removeWorktreeOnce(db, key, LATER)).toEqual({ ok: true });
    expect(removeWorktreeOnce(db, { runId, requestId: OTHER_REQUEST }, LATER)).toEqual({
      ok: false,
      reason: "nothing-to-remove",
    });
  });

  it("멈추기: 처리된 뒤 다시 보내도 새 요청을 만들지 않는다", () => {
    const { db } = seedDatabase();
    const runId = runningRun(db);
    const key = { runId, requestId: REQUEST };

    expect(controlRunOnce(db, key, "pause", FIRST)).toEqual({ ok: true });
    const first = getRunControlRequest(db, runId);
    expect(controlRunOnce(db, key, "pause", LATER)).toEqual({ ok: true });

    expect(getRunControlRequest(db, runId)).toEqual(first);
  });

  it("이전 에이전트 멈추기: 다시 보내도 처음 요청 시각을 지킨다", () => {
    const { db } = seedDatabase();
    const runId = endedRun(db, "alive");
    const key = { runId, requestId: REQUEST };
    const stoppedAt = () =>
      db.$client.prepare("SELECT agent_stop_requested_at AS at FROM runs WHERE id = ?").get(runId);

    expect(stopPreviousAgentOnce(db, key, FIRST)).toEqual({ ok: true });
    expect(stopPreviousAgentOnce(db, key, LATER)).toEqual({ ok: true });

    expect(stoppedAt()).toEqual({ at: FIRST.getTime() });
  });

  it("답하기: 다시 보내도 답은 하나이고 오류가 아니다", () => {
    const { db } = seedDatabase();
    const runId = waitingRun(db, "question");
    const input = { runId, requestId: REQUEST, questionId: "q-1", answer: "네" };

    submitAnswerOnce(db, input, FIRST);
    expect(() => submitAnswerOnce(db, input, LATER)).not.toThrow();

    expect(answersOf(db, runId)).toEqual(["네"]);
  });

  it("Human Check 답: 다시 보내도 답은 하나이고 오류가 아니다", () => {
    const { db } = seedDatabase();
    const runId = waitingRun(db, "human-check");
    const input = {
      runId,
      requestId: REQUEST,
      questionId: "q-1",
      decision: "confirmed" as const,
      note: "",
    };

    submitHumanCheckOnce(db, input, FIRST);
    expect(() => submitHumanCheckOnce(db, input, LATER)).not.toThrow();

    expect(answersOf(db, runId)).toEqual(["확인했어요"]);
  });

  it("이어서 맡기기: 다시 보내도 새 런은 하나이고 같은 런 ID를 돌려준다", () => {
    const { db } = seedDatabase();
    const runId = endedRun(db, "gone");
    const ticket = listRuns(db, {}).find((run) => run.id === runId)?.ticket;
    if (ticket === undefined) throw new Error("no ticket");
    const key = { runId, requestId: REQUEST };
    const before = listRuns(db, { ticket }).length;

    const first = continueRunOnce(db, key, "이어 주세요", FIRST);
    const second = continueRunOnce(db, key, "이어 주세요", LATER);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(listRuns(db, { ticket })).toHaveLength(before + 1);
  });

  it("이어서 맡긴 런이 시작 없이 끝났으면 같은 ID로 다시 맡길 수 있다", () => {
    const { db } = seedDatabase();
    const runId = endedRun(db, "gone");
    const key = { runId, requestId: REQUEST };
    const first = continueRunOnce(db, key, "이어 주세요", FIRST);
    if (!first.ok) throw new Error(first.reason);
    const ended = changeRunState(
      db,
      first.runId,
      { to: "ended", agentResult: "canceled", prState: "none" },
      minutes(112),
    );
    if (!ended.ok) throw new Error("state change failed");

    const second = continueRunOnce(db, key, "이어 주세요", LATER);

    expect(second.ok).toBe(true);
    expect(second).not.toEqual(first);
    expect(requestRows(db, runId)).toHaveLength(1);
  });

  it("같은 ID로 다른 내용을 보내면 처리하지 않고 거절한다", () => {
    const { db } = seedDatabase();
    const runId = waitingRun(db, "question");
    submitAnswerOnce(db, { runId, requestId: REQUEST, questionId: "q-1", answer: "네" }, FIRST);

    expect(() =>
      submitAnswerOnce(
        db,
        { runId, requestId: REQUEST, questionId: "q-1", answer: "아니요" },
        LATER,
      ),
    ).toThrow(AnswerRejectedError);
    expect(controlRunOnce(db, { runId, requestId: REQUEST }, "pause", LATER)).toEqual({
      ok: false,
      reason: "request-reused",
    });
    expect(answersOf(db, runId)).toEqual(["네"]);
  });

  it("거절된 요청은 기록하지 않아 상태가 바뀌면 같은 ID로 다시 처리할 수 있다", () => {
    const { db } = seedDatabase();
    const runId = runningRun(db);
    const key = { runId, requestId: REQUEST };

    expect(controlRunOnce(db, key, "resume", FIRST).ok).toBe(false);
    expect(requestRows(db, runId)).toEqual([]);
  });

  it("없는 런은 기록 없이 거절한다", () => {
    const { db } = seedDatabase();

    expect(cancelRunOnce(db, { runId: "missing-run", requestId: REQUEST }, FIRST).ok).toBe(false);
    expect(db.$client.prepare("SELECT id FROM run_action_requests").all()).toEqual([]);
  });
});
