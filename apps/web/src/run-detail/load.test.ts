import {
  toAgentId,
  toPullRequestId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import type { RunId } from "@factory/core";
import type { RunStateChange } from "@factory/db";
import {
  assignRun,
  changeRunState,
  completeLogTailRequest,
  getLogTailRequest,
  updateRunRecords,
} from "@factory/db";
import { describe, expect, it } from "vitest";
import { connection, endedCases, minutes, now, seedDatabase } from "../testing/seed";
import { loadRunDetail, requestRunLogTail, toCiView } from "./load";
import type { RunDetail } from "./model";

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

  it("Ended 런에 두 축과 core 로 계산한 요약 결과를 담는다", () => {
    const { db, ids } = seedDatabase();
    for (const c of endedCases) {
      expect({ key: c.key, status: detail(db, ids.get(c.key)).status }).toMatchObject({
        key: c.key,
        status: {
          state: "ended",
          agentResult: c.agentResult,
          prState: c.prState,
          summary: c.summary,
        },
      });
    }
  });

  it("러너 연결 끊김 런은 워크트리를 지우기 전까지 사람이 지워야 한다(Q75)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-5");
    expect(detail(db, id).status).toMatchObject({ worktreeNeedsManualRemoval: true });
    // 그 밖의 결과는 사람이 지울 일이 없다
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
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-40") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(50),
    });
    if (!result.ok) throw new Error(result.reason);
    const id = result.run.id;
    const steps: RunStateChange[] = [
      { to: "running", worktree: toWorktreeRef("wt-40") },
      { to: "waiting-for-input" },
      { to: "disconnected" },
      { to: "waiting-for-input" },
      { to: "running" },
      { to: "ended", agentResult: "exited-normally", prState: "open" },
    ];
    steps.forEach((step, i) => {
      const r = changeRunState(db, id, step, minutes(51 + i));
      if (!r.ok) throw new Error(JSON.stringify(r));
    });
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(70) } });

    const run = detail(db, id);
    expect(run.timeline).toEqual([
      { kind: "assigned", at: minutes(50).toISOString() },
      { kind: "started", at: minutes(51).toISOString() },
      { kind: "waiting-for-input", at: minutes(52).toISOString() },
      { kind: "disconnected", at: minutes(53).toISOString() },
      { kind: "reconnected", at: minutes(54).toISOString() },
      { kind: "resumed", at: minutes(55).toISOString() },
      { kind: "ended", agentResult: "exited-normally", at: minutes(56).toISOString() },
      { kind: "later-pr", state: "merged", at: minutes(70).toISOString() },
    ]);
    expect(run.status).toMatchObject({
      laterPrState: { state: "merged", at: minutes(70).toISOString() },
    });
  });

  it("대기 시간과 실행 시간을 나눠 담는다(Q59)", () => {
    const { db, ids } = seedDatabase();
    // ACME-2: 2분에 할당, 3분에 시작, 32분에 끝남
    expect(detail(db, ids.get("ACME-2"))).toMatchObject({
      waitMs: 60_000,
      executionMs: 29 * 60_000,
    });
    // Queued 는 지금까지 기다렸고 실행 시간이 없다
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

  it("같은 티켓의 다른 런을 새 것부터 담는다", () => {
    const { db, ids } = seedDatabase();
    const first = ids.get("ACME-1");
    if (first === undefined) throw new Error("no ACME-1");
    const again = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-1") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(90),
    });
    if (!again.ok) throw new Error(again.reason);
    expect(detail(db, again.run.id).otherRuns).toEqual([
      { id: first, assignedAt: minutes(1).toISOString(), state: "ended", summary: "merged" },
    ]);
    expect(detail(db, first).otherRuns.map((o) => o.id)).toEqual([again.run.id]);
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
