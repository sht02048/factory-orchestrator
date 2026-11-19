import { AGENT_RESULTS, toPermissionRequestId, toPullRequestId, toQuestionId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import type { Database } from "@ganger/db";
import {
  changeRunState,
  completeLogTailRequest,
  getLogTailRequest,
  listRunPermissionWaits,
  listRunQuestions,
  markAnswerSent,
  markCancelRequestProcessed,
  recordPermissionWaits,
  recordRunQuestions,
  recordStartFailure,
  updateRunRecords,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { endedCases, minutes, now, seedDatabase } from "../testing/seed";
import {
  AnswerRejectedError,
  answerInput,
  denyInput,
  submitAnswer,
  submitDenial,
} from "@ganger/app/home/actions";
import { cancelRunRequest } from "@ganger/app/run-detail/actions";
import { loadRunDetail, requestRunLogTail, toCiView } from "@ganger/app/run-detail/load";
import { addExtraEnded, assign, extraEndedCases, startedOn, walk } from "./testing";
import type { RunDetail } from "@ganger/app/run-detail/model";

function detail(db: Parameters<typeof loadRunDetail>[0], id: RunId | undefined): RunDetail {
  if (id === undefined) throw new Error("no run id");
  const page = loadRunDetail(db, id, now);
  if (page.kind !== "found") throw new Error(`run ${id} not found`);
  return page.run;
}

describe("loadRunDetail", () => {
  it("모르는 런이면 not-found 다", () => {
    const { db } = seedDatabase();
    expect(loadRunDetail(db, "run-missing", now)).toEqual({ kind: "not-found" });
  });

  it("에이전트 결과 아홉과 PR 상태 넷에 core 로 계산한 요약 결과(Canceled 포함)를 담는다", () => {
    const { db, ids } = seedDatabase();
    const extra = addExtraEnded(db);
    const cases = [
      ...endedCases.map((c) => ({ ...c, id: ids.get(c.key) })),
      ...extraEndedCases.map((c) => ({ ...c, id: extra.get(c.key) })),
    ];
    for (const c of cases) {
      expect({ key: c.key, status: detail(db, c.id).status }).toMatchObject({
        key: c.key,
        status: {
          state: "ended",
          agentResult: c.agentResult,
          prState: c.prState,
          summary: c.summary,
        },
      });
    }
    expect(new Set(cases.map((c) => c.agentResult))).toEqual(new Set(AGENT_RESULTS));
    expect(new Set(cases.map((c) => c.prState)).size).toBe(4);
  });

  it("러너에 닿지 못한 채 끝난 취소 런도 사람이 지워야 한다(Q82.21)", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    expect(detail(db, extra.get("ACME-22")).status).toMatchObject({
      summary: "canceled",
      worktreeNeedsManualRemoval: true,
    });
    expect(detail(db, extra.get("ACME-21")).status).toMatchObject({
      worktreeNeedsManualRemoval: false,
    });
  });

  it("시작하지 않고 끝난 런은 브랜치·워크트리가 없고 실행 시간이 0 이다(Q82.10·Q82.20)", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    expect(detail(db, extra.get("ACME-23"))).toMatchObject({
      branch: null,
      worktree: null,
      startedAt: null,
      waitMs: 60_000,
      executionMs: 0,
      startError: null,
    });
  });

  it("시작할 수 없음으로 끝난 런은 마지막 시작 오류를 담는다(Q86)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-30", 60);
    recordStartFailure(db, id, { failures: 3, error: "worker-start: project not found" });
    walk(db, id, 60, [{ to: "ended", agentResult: "could-not-start", prState: "none" }]);
    expect(detail(db, id)).toMatchObject({
      startError: "worker-start: project not found",
      status: { agentResult: "could-not-start", summary: "failed" },
    });
  });

  it("완료 보고 본문을 담는다(Q82.2)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-31", 60);
    walk(db, id, 60, [
      startedOn("ACME-31"),
      {
        to: "ended",
        agentResult: "reported-failure",
        prState: "open",
        reportBody: "테스트 하나를 고치지 못했어요.",
      },
    ]);
    expect(detail(db, id)).toMatchObject({
      report: "테스트 하나를 고치지 못했어요.",
      status: { agentResult: "reported-failure", prState: "open", summary: "human-check" },
    });
  });

  it("러너 연결 끊김 런은 워크트리를 지우기 전까지 사람이 지워야 한다(Q75)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-5");
    expect(detail(db, id).status).toMatchObject({ worktreeNeedsManualRemoval: true });
    expect(detail(db, ids.get("ACME-3")).status).toMatchObject({
      worktreeNeedsManualRemoval: false,
    });
    if (id === undefined) throw new Error("no ACME-5");
    updateRunRecords(db, id, { worktreeRemovedAt: minutes(100) });
    expect(detail(db, id).status).toMatchObject({ worktreeNeedsManualRemoval: false });
  });

  it("Disconnected 런은 ssh 가 실패하기 시작한 시각을 담고 타임라인에 남긴다(Q50·Q67)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-12");
    if (id === undefined) throw new Error("no ACME-12");
    updateRunRecords(db, id, { unreachableSince: minutes(40) });
    const run = detail(db, id);
    expect(run.status).toEqual({
      state: "disconnected",
      unreachableSince: minutes(40).toISOString(),
    });
    expect(run.timeline.map((e) => e.kind)).toEqual([
      "assigned",
      "started",
      "disconnected",
      "unreachable",
    ]);
  });

  it("타임라인은 할당·시작·입력 기다림·연결 끊김·다시 연결·종료와 이후 PR 상태를 시각 순서로 담는다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-40", 50);
    walk(db, id, 50, [
      startedOn("ACME-40"),
      { to: "waiting-for-input" },
      { to: "disconnected" },
      { to: "waiting-for-input" },
      { to: "running" },
      { to: "ended", agentResult: "reported-success", prState: "open" },
    ]);
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(70) } });

    const run = detail(db, id);
    expect(run.timeline).toEqual([
      { kind: "assigned", at: minutes(50).toISOString() },
      { kind: "started", at: minutes(51).toISOString() },
      { kind: "waiting-for-input", at: minutes(52).toISOString() },
      { kind: "disconnected", at: minutes(53).toISOString() },
      { kind: "reconnected", at: minutes(54).toISOString() },
      { kind: "resumed", at: minutes(55).toISOString() },
      { kind: "ended", agentResult: "reported-success", at: minutes(56).toISOString() },
      { kind: "later-pr", state: "merged", at: minutes(70).toISOString() },
    ]);
    expect(run.status).toMatchObject({
      laterPrState: { state: "merged", at: minutes(70).toISOString() },
    });
  });

  it("대기 시간과 실행 시간을 나눠 담는다(Q59)", () => {
    const { db, ids } = seedDatabase();
    expect(detail(db, ids.get("ACME-2"))).toMatchObject({
      waitMs: 60_000,
      executionMs: 29 * 60_000,
    });
    expect(detail(db, ids.get("ACME-13"))).toMatchObject({ executionMs: null, worktree: null });
  });

  it("PR 과 CI 상태를 담고, 볼 수 없는 CI 는 요약 결과를 바꾸지 않는다(Q79)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("no ACME-2");
    expect(detail(db, id).pullRequest).toEqual({
      displayId: "#2",
      url: "https://example.com/acme/web/pull/2",
      ci: "success",
    });
    expect(toCiView("failure")).toBe("failure");
    expect(toCiView("unavailable")).toBe("unavailable");
    expect(toCiView("something-new")).toBe("unknown");
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("pr-2"),
        displayId: "#2",
        url: "javascript:alert(1)",
        ci: "success",
        checkedAt: minutes(40),
      },
    });
    expect(detail(db, id).pullRequest).toBeNull();
  });

  it("CI 상태를 볼 수 없어도 요약 결과는 그대로다(Q79)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("no ACME-2");
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("pr-2"),
        displayId: "#2",
        url: "https://example.com/acme/web/pull/2",
        ci: "unavailable",
        checkedAt: minutes(40),
      },
    });
    expect(detail(db, id)).toMatchObject({
      pullRequest: { ci: "unavailable" },
      status: { summary: "human-check" },
    });
  });

  it("같은 티켓의 다른 런을 새 것부터 담는다", () => {
    const { db, ids } = seedDatabase();
    const first = ids.get("ACME-1");
    if (first === undefined) throw new Error("no ACME-1");
    const again = assign(db, "ACME-1", 90);
    expect(detail(db, again).otherRuns).toEqual([
      { id: first, assignedAt: minutes(1).toISOString(), state: "ended", summary: "merged" },
    ]);
    expect(detail(db, first).otherRuns.map((o) => o.id)).toEqual([again]);
  });
});

describe("로그 꼬리(Q46·Q61)", () => {
  it("화면을 열면 요청이 DB 에 하나 생기고, worker 가 쓴 결과가 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    expect(getLogTailRequest(db, id)).toBeNull();

    expect(requestRunLogTail(db, id, minutes(100))).toBe(true);
    expect(getLogTailRequest(db, id)).toEqual({ status: "pending", requestedAt: minutes(100) });
    expect(detail(db, id).log).toEqual({ kind: "pending" });

    completeLogTailRequest(db, {
      runId: id,
      requestedAt: minutes(100),
      completedAt: minutes(101),
      lines: ["build ok", "tests ok"],
    });
    expect(detail(db, id).log).toEqual({
      kind: "done",
      lines: ["build ok", "tests ok"],
      at: minutes(101).toISOString(),
    });
  });

  it("worker 가 가져오지 못했으면 그 오류를 담는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    requestRunLogTail(db, id, minutes(100));
    completeLogTailRequest(db, {
      runId: id,
      requestedAt: minutes(100),
      completedAt: minutes(101),
      error: "ssh timeout",
    });
    expect(detail(db, id).log).toEqual({
      kind: "failed",
      error: "ssh timeout",
      at: minutes(101).toISOString(),
    });
  });

  it("Queued 와 Ended 런은 요청하지 않는다. Ended 는 저장한 마지막 줄을 보인다", () => {
    const { db, ids } = seedDatabase();
    const queued = ids.get("ACME-13");
    const ended = ids.get("ACME-1");
    if (queued === undefined || ended === undefined) throw new Error("missing runs");
    expect(requestRunLogTail(db, queued, minutes(100))).toBe(false);
    expect(requestRunLogTail(db, ended, minutes(100))).toBe(false);
    expect(requestRunLogTail(db, "run-missing", minutes(100))).toBe(false);
    expect(getLogTailRequest(db, queued)).toBeNull();
    expect(getLogTailRequest(db, ended)).toBeNull();

    expect(detail(db, queued).log).toEqual({ kind: "none" });
    updateRunRecords(db, ended, { lastLog: ["done", "pushed"] });
    expect(detail(db, ended).log).toEqual({ kind: "stored", lines: ["done", "pushed"] });
  });
});

describe("질문과 답(Q82.3)", () => {
  function waitingWithQuestion() {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      {
        id: toQuestionId("q-1"),
        body: "마이그레이션을 지금 돌릴까요?",
        options: ["돌려 주세요", "멈춰 주세요"],
        askedAt: minutes(60),
      },
    ]);
    return { db, id };
  }

  function answer(db: Database, runId: string, questionId: string, text: string, at: number) {
    submitAnswer(db, answerInput.parse({ runId, questionId, answer: text }), minutes(at));
  }

  it("질문으로 기다리는 런은 질문 내용과 선택지를 담는다", () => {
    const { db, id } = waitingWithQuestion();
    expect(detail(db, id).status).toEqual({
      state: "waiting-for-input",
      input: {
        kind: "question",
        questionId: "q-1",
        body: "마이그레이션을 지금 돌릴까요?",
        choices: ["돌려 주세요", "멈춰 주세요"],
        answered: false,
      },
      inputSince: minutes(60).toISOString(),
    });
  });

  it("답하면 DB 에 답이 하나 생기고, 지난 질문과 답은 타임라인에 남는다", () => {
    const { db, id } = waitingWithQuestion();
    answer(db, id, "q-1", " 돌려 주세요 ", 61);
    expect(listRunQuestions(db, id).map((q) => q.answer)).toEqual([
      { text: "돌려 주세요", answeredAt: minutes(61), sentAt: null },
    ]);
    expect(() => answer(db, id, "q-1", "멈춰 주세요", 62)).toThrow(AnswerRejectedError);
    expect(listRunQuestions(db, id)).toHaveLength(1);

    const run = detail(db, id);
    expect(run.status).toMatchObject({ input: { kind: "question", answered: true } });
    expect(run.timeline.filter((e) => e.kind === "question" || e.kind === "answer")).toEqual([
      { kind: "question", body: "마이그레이션을 지금 돌릴까요?", at: minutes(60).toISOString() },
      { kind: "answer", body: "돌려 주세요", at: minutes(61).toISOString() },
    ]);
    markAnswerSent(db, { runId: id, questionId: toQuestionId("q-1") }, minutes(63));
    expect(detail(db, id).status).toEqual({
      state: "waiting-for-input",
      input: { kind: "unknown" },
      inputSince: null,
    });
  });

  it("빈 답과 모르는 질문은 받지 않는다", () => {
    const { db, id } = waitingWithQuestion();
    expect(() => answer(db, id, "q-1", "  ", 61)).toThrow(z.ZodError);
    expect(() => answer(db, id, "q-9", "네", 61)).toThrow(AnswerRejectedError);
    expect(listRunQuestions(db, id)[0]?.answer).toBeNull();
  });
});

describe("권한 대기(Q82.4)", () => {
  function waitingForPermission() {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      {
        id: toPermissionRequestId("perm-1"),
        detail: "Bash: rm -rf node_modules",
        requestedAt: minutes(60),
      },
    ]);
    return { db, id };
  }

  it("권한 대기 런은 무엇을 허용하려는지 담는다", () => {
    const { db, id } = waitingForPermission();
    expect(detail(db, id).status).toEqual({
      state: "waiting-for-input",
      input: {
        kind: "permission",
        promptId: "perm-1",
        detail: "Bash: rm -rf node_modules",
        denied: false,
      },
      inputSince: minutes(60).toISOString(),
    });
  });

  it("거절하면 DB 에 거절이 하나 생기고 타임라인에 남는다", () => {
    const { db, id } = waitingForPermission();
    submitDenial(
      db,
      denyInput.parse({ runId: id, promptId: "perm-1", reason: "지우지 말고 캐시만 비워 주세요" }),
      minutes(61),
    );
    expect(listRunPermissionWaits(db, id).map((w) => w.denial)).toEqual([
      { reason: "지우지 말고 캐시만 비워 주세요", deniedAt: minutes(61), sentAt: null },
    ]);
    const run = detail(db, id);
    expect(run.status).toMatchObject({ input: { kind: "permission", denied: true } });
    expect(run.timeline.filter((e) => e.kind === "permission" || e.kind === "denied")).toEqual([
      { kind: "permission", body: "Bash: rm -rf node_modules", at: minutes(60).toISOString() },
      { kind: "denied", body: "지우지 말고 캐시만 비워 주세요", at: minutes(61).toISOString() },
    ]);
  });
});

describe("취소(Q77·Q82.8·Q82.21)", () => {
  it("끝나지 않은 런은 취소 요청이 하나 생기고 취소 중이다", () => {
    const { db, ids } = seedDatabase();
    for (const key of ["ACME-10", "ACME-11", "ACME-12", "ACME-13"]) {
      const id = ids.get(key);
      if (id === undefined) throw new Error(`no ${key}`);
      expect(detail(db, id).cancelPending).toBe(false);
      expect(cancelRunRequest(db, id, minutes(100))).toEqual({ ok: true });
      expect(cancelRunRequest(db, id, minutes(101))).toEqual({ ok: true });
      const run = detail(db, id);
      expect(run.cancelPending).toBe(true);
      expect(run.timeline.filter((e) => e.kind === "cancel-requested")).toEqual([
        { kind: "cancel-requested", at: minutes(100).toISOString() },
      ]);
    }
  });

  it("Ended 런의 취소는 거부한다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-1");
    if (id === undefined) throw new Error("no ACME-1");
    expect(cancelRunRequest(db, id, minutes(100))).toEqual({ ok: false, reason: "already-ended" });
    expect(detail(db, id).cancelPending).toBe(false);
  });

  it("worker 가 처리하면 취소 중이 사라지고 종료로 남는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-13");
    if (id === undefined) throw new Error("no ACME-13");
    cancelRunRequest(db, id, minutes(100));
    const ended = changeRunState(
      db,
      id,
      { to: "ended", agentResult: "canceled", prState: "none" },
      minutes(101),
    );
    if (!ended.ok) throw new Error(JSON.stringify(ended));
    markCancelRequestProcessed(db, id, minutes(101));
    const run = detail(db, id);
    expect(run.cancelPending).toBe(false);
    expect(run.status).toMatchObject({ agentResult: "canceled", summary: "canceled" });
    expect(run.timeline.slice(-2)).toEqual([
      { kind: "cancel-requested", at: minutes(100).toISOString() },
      { kind: "ended", agentResult: "canceled", at: minutes(101).toISOString() },
    ]);
  });

  it("다른 결과로 끝나 처리되지 않은 요청이 남아도 Ended 런은 취소 중이 아니다(Q82.21)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    cancelRunRequest(db, id, minutes(100));
    const ended = changeRunState(
      db,
      id,
      { to: "ended", agentResult: "reported-success", prState: "merged" },
      minutes(101),
    );
    if (!ended.ok) throw new Error(JSON.stringify(ended));
    const run = detail(db, id);
    expect(run.cancelPending).toBe(false);
    expect(run.timeline.filter((e) => e.kind === "cancel-requested")).toEqual([
      { kind: "cancel-requested", at: minutes(100).toISOString() },
    ]);
  });
});
