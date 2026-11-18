import {
  toAgentId,
  toAgentRef,
  toPermissionRequestId,
  toQuestionId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import type { RunId } from "@factory/core";
import {
  answerRunQuestion,
  denyPermissionWait,
  assignRun,
  changeRunState,
  recordPermissionWaits,
  recordRunQuestions,
  resolvePermissionWaits,
  recordRunnerCheck,
  requestRunCancel,
  updateRunRecords,
} from "@factory/db";
import type { Database } from "@factory/db";
import { describe, expect, it } from "vitest";
import {
  breakGitHubAuth,
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadShell } from "../shell/load";
import { loadHomePage } from "./load";
import type { AttentionItem, HomeRun } from "./model";

const keys = (runs: ReadonlyArray<HomeRun>) => runs.map((run) => run.ticketKey);
const attentionKeys = (items: ReadonlyArray<AttentionItem>) =>
  items.map((item) => item.run.ticketKey);

function addEndedRun(
  db: Database,
  input: { key: string; trackerProject: string; agentResult: "timed-out" | "canceled" },
): RunId {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(input.key) },
    trackerProject: toTrackerProjectId(input.trackerProject),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: minutes(60),
  });
  if (!result.ok) throw new Error(result.reason);
  const { id } = result.run;
  const started = {
    worktree: toWorktreeRef(`wt-${input.key}`),
    branch: `acme/${input.key}`,
    agentRef: toAgentRef(`agent-${input.key}`),
  };
  for (const change of [
    changeRunState(db, id, { to: "running", started }, minutes(61)),
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: input.agentResult, prState: "open" },
      minutes(90),
    ),
  ]) {
    if (!change.ok) throw new Error(JSON.stringify(change));
  }
  return id;
}

function addLabsFailedRun(db: Database): void {
  addEndedRun(db, { key: "LAB-2", trackerProject: "tp-lab", agentResult: "timed-out" });
}

function runOf(items: ReadonlyArray<AttentionItem>, key: string): HomeRun | undefined {
  for (const item of items) if (item.kind === "run" && item.run.ticketKey === key) return item.run;
  return undefined;
}

describe("loadHomePage", () => {
  it("런을 To do, 실행 중, Queued 로 나눈다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");

    const attention = attentionKeys(page.attention);
    expect(attention.slice(0, 2)).toEqual(["ACME-11", "ACME-12"]);
    expect(attention.slice(2).toSorted()).toEqual(
      endedCases
        .filter((c) => c.summary !== "merged")
        .map((c) => c.key)
        .toSorted(),
    );
    expect(attention.slice(2)).toEqual(attention.slice(2).toSorted().toReversed());
    expect(attention).not.toContain("ACME-1");

    expect(keys(page.running)).toEqual(["ACME-10"]);
    expect(keys(page.queued)).toEqual(["ACME-13", offlineQueuedKey]);
  });

  it("Queued 는 들어온 순서로 보이고, 순서에서 빠진 런에는 이유를 담는다(Q68)", () => {
    const { db } = seedDatabase();
    const early = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-20") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(0.5),
    });
    if (!early.ok) throw new Error(early.reason);

    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(keys(page.queued)).toEqual(["ACME-20", "ACME-13", offlineQueuedKey]);
    const offline = page.queued.find((run) => run.ticketKey === offlineQueuedKey);
    expect(offline).toMatchObject({ queuedReason: { kind: "runner-offline" }, runner: null });
  });

  it("입력 기다림과 연결 끊김 런을 상태 그대로 손댈 일에 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const runs = page.attention.flatMap((item) => (item.kind === "run" ? [item.run] : []));
    expect(runs.find((run) => run.ticketKey === "ACME-11")?.state).toBe("waiting-for-input");
    expect(runs.find((run) => run.ticketKey === "ACME-12")?.state).toBe("disconnected");
  });

  it("손댈 일의 Ended 런은 에이전트 결과와 PR 상태를 따로 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const run = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "ACME-2",
    );
    expect(run).toMatchObject({
      kind: "run",
      run: {
        state: "ended",
        agentResult: "reported-failure",
        prState: "open",
        summary: "human-check",
      },
    });
  });

  it("같은 티켓에 새 런이 있으면 지난 Ended 런은 손댈 일에서 빠진다", () => {
    const { db } = seedDatabase();
    const again = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-3") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(100),
    });
    if (!again.ok) throw new Error(again.reason);
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-3");
    expect(keys(page.queued)).toContain("ACME-3");
  });

  it("Human Check 런은 사람이 PR 을 병합하거나 닫으면 손댈 일에서 빠진다(Q89)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("ACME-2 missing");
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(110) } });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-2");
    const failedId = ids.get("ACME-5");
    if (failedId === undefined) throw new Error("ACME-5 missing");
    updateRunRecords(db, failedId, { laterPrState: { state: "closed", at: minutes(110) } });
    expect(attentionKeys(loadHomePage(db, "ws-commerce", now, "UTC").attention)).toContain(
      "ACME-5",
    );
  });

  it("Canceled 런은 PR 이 열려 있어도 손댈 일에 없다(Q82.9)", () => {
    const { db } = seedDatabase();
    addEndedRun(db, { key: "ACME-30", trackerProject: "tp-web", agentResult: "canceled" });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-30");
    expect(keys(page.running)).not.toContain("ACME-30");
    expect(attentionKeys(loadHomePage(db, "all", now, "UTC").attention)).not.toContain("ACME-30");
  });

  it("질문으로 기다리는 런에 worker 가 쓴 질문과 선택지를 담고, 답을 남기면 answered 가 된다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      state: "waiting-for-input",
      input: null,
    });

    recordRunQuestions(db, runId, [
      {
        id: toQuestionId("q-1"),
        body: "어느 쪽으로 할까요?",
        options: ["A", "B"],
        askedAt: minutes(100),
      },
    ]);
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: {
        kind: "question",
        questionId: "q-1",
        body: "어느 쪽으로 할까요?",
        choices: ["A", "B"],
        answered: false,
      },
    });

    answerRunQuestion(db, { runId, questionId: toQuestionId("q-1"), answer: "A" }, minutes(101));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: { kind: "question", answered: true },
    });
  });

  it("권한 대기 런에 worker 가 쓴 대기를 담고, 거절을 남기면 denied, 닫히면 빠진다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    const permissionId = toPermissionRequestId("apr-1");
    recordPermissionWaits(db, runId, [
      { id: permissionId, detail: "Bash(touch notes.txt)", requestedAt: minutes(100) },
    ]);
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: {
        kind: "permission",
        promptId: "apr-1",
        detail: "Bash(touch notes.txt)",
        denied: false,
      },
    });

    denyPermissionWait(db, { runId, permissionId, reason: "" }, minutes(101));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: { kind: "permission", denied: true },
    });

    resolvePermissionWaits(db, runId, [], minutes(102));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: null,
    });
  });

  it("처리되지 않은 취소 요청이 있는 런은 취소 중이다(Q82.21)", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-10");
    if (runId === undefined) throw new Error("ACME-10 missing");
    expect(requestRunCancel(db, runId, minutes(110)).ok).toBe(true);
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.running.find((run) => run.ticketKey === "ACME-10")?.cancelling).toBe(true);
    expect(page.queued.every((run) => !run.cancelling)).toBe(true);
  });

  it("러너 문제는 To do 에 없고 Runners 카드의 문제 러너로 담고, 나머지는 Online 수로 센다(티켓 0060)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.attention.every((item) => item.kind === "run")).toBe(true);
    expect(page.runners).toEqual({
      issues: [{ id: "runner-b", name: "runner-b", cause: "offline" }],
      online: 1,
    });
    expect(loadShell(db).runnerIssues).toBe(1);

    breakGitHubAuth(db);
    expect(loadShell(db).runnerIssues).toBe(2);
    const broken = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(broken.runners.issues.map((r) => r.id).toSorted()).toEqual(["runner-a", "runner-b"]);
    expect(broken.runners.online).toBe(0);
    expect(attentionKeys(broken.attention)).toEqual(attentionKeys(page.attention));
  });

  it("GitHub 인증이 깨진 러너는 auth 까닭으로 담고, 그 러너로 정한 Queued 런은 이유를 담는다(Q82.14·Q87)", () => {
    const { db } = seedDatabase();
    recordRunnerCheck(db, {
      runnerId: toRunnerId("runner-a"),
      online: true,
      checkedAt: minutes(115),
      error: null,
      assignmentBlocked: true,
      projects: null,
    });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.runners.issues).toContainEqual({ id: "runner-a", name: "runner-a", cause: "auth" });
    expect(page.queued.find((run) => run.ticketKey === "ACME-13")).toMatchObject({
      queuedReason: { kind: "assignment-blocked" },
    });
    expect(loadHomePage(db, labs, now, "UTC").runners.issues.map((r) => r.id)).toContain(
      "runner-a",
    );
    expect(loadHomePage(db, "all", now, "UTC").runners.issues.map((r) => r.id)).toContain(
      "runner-a",
    );
  });

  it("전체에서는 모든 Workspace 의 손댈 일만 담는다(ADR 0006)", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, "all", now, "UTC");
    expect(page.workspace.kind).toBe("all");
    expect(page.running).toEqual([]);
    expect(page.queued).toEqual([]);
    const attention = attentionKeys(page.attention);
    expect(attention).toContain("LAB-2");
    expect(attention).toContain("ACME-11");
    expect(attention).not.toContain("LAB-1");
    const lab = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "LAB-2",
    );
    expect(lab).toMatchObject({ run: { workspace: { id: labs, name: "Acme Labs" } } });
  });

  it("Workspace 하나에서는 그 Workspace 의 런만 담는다", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, labs, now, "UTC");
    expect(attentionKeys(page.attention)).toEqual(["LAB-2"]);
    expect(keys(page.running)).toEqual(["LAB-1"]);
    expect(page.queued).toEqual([]);
  });

  it("Done today 는 운영자 시간대의 오늘 끝난 런을 새 것부터 5개까지 담고 전체 수를 센다(티켓 0060)", () => {
    const { db } = seedDatabase();
    const { doneToday } = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(doneToday.recent.map((run) => run.ticketKey)).toEqual([
      "ACME-7",
      "ACME-6",
      "ACME-5",
      "ACME-4",
      "ACME-3",
    ]);
    expect(doneToday.recent[0]).toMatchObject({
      summary: "failed",
      workspace: { id: "ws-commerce" },
      endedAgoMs: 83 * 60_000,
    });
    expect(doneToday.total).toBe(7);

    const kiritimati = loadHomePage(db, "ws-commerce", now, "Pacific/Kiritimati").doneToday;
    expect(kiritimati).toEqual({ recent: [], total: 0 });

    addEndedRun(db, { key: "ACME-30", trackerProject: "tp-web", agentResult: "canceled" });
    const withCanceled = loadHomePage(db, "ws-commerce", now, "UTC").doneToday;
    expect(withCanceled.total).toBe(8);
    expect(withCanceled.recent.map((run) => run.summary)).toContain("canceled");
    expect(loadHomePage(db, "all", now, "UTC").doneToday).toEqual({ recent: [], total: 0 });
  });

  it("질문을 기다리는 런은 가장 오래된 대기부터 지난 시간을 담는다", () => {
    const { db, ids } = seedDatabase();
    const waiting = ids.get("ACME-11");
    if (waiting === undefined) throw new Error("seed");
    recordRunQuestions(db, waiting, [
      {
        id: toQuestionId("q-wait"),
        body: "어느 쪽으로 할까요?",
        options: [],
        askedAt: minutes(95),
      },
    ]);
    const run = loadHomePage(db, "ws-commerce", now, "UTC").attention.find(
      (item) => item.run.ticketKey === "ACME-11",
    )?.run;
    expect(run).toMatchObject({ state: "waiting-for-input", waitingMs: 25 * 60_000 });
  });
});
