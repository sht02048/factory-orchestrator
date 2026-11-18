import {
  AGENT_RESULTS,
  PR_STATES,
  summarizeRunOutcome,
  toDeliveryId,
  toPullRequestId,
  toAgentId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toAgentRef,
  toLabelId,
  toQuestionId,
  toRunId,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { AgentId, RunId, RunState, RunnerId, TicketRef } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import {
  listUnprocessedTrackerEvents,
  markTrackerEventProcessed,
  recordTrackerEvent,
} from "./events.js";
import {
  answerRunQuestion,
  listRunQuestions,
  listUnsentAnswers,
  markAnswerSent,
  recordRunQuestions,
  sentQuestionIds,
} from "./questions.js";
import {
  getRunCancelRequest,
  hasPendingCancelRequest,
  listPendingCancelRequests,
  markCancelRequestProcessed,
  requestRunCancel,
} from "./requests.js";
import {
  assignRun,
  changeRunState,
  getRunWithRecords,
  listRunStateChanges,
  listRuns,
  listRunsWithRecords,
  recordStartFailure,
  recordStartRequested,
  setQueuedRunRunner,
  updateRunRecords,
} from "./runs.js";
import { SecretBox } from "./secret-box.js";
import { saveTrackerConnection, saveWorkspaceTrackerProject } from "./settings.js";
import type { RunStateChange } from "./runs.js";
import {
  KEY,
  addRunner,
  agent,
  connection,
  repoA,
  repoB,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const ticket = (key: string): TicketRef => ({ connection, key: toTicketKey(key) });
const worktree = toWorktreeRef("repo::/wt/1");
const started = { worktree, branch: "acme/ganger-ENG-1-1", agentRef: toAgentRef("agent-1") };

function assign(
  db: Database,
  key: string,
  extra: { runnerId?: ReturnType<typeof addRunner> } = {},
) {
  return assignRun(db, {
    ticket: ticket(key),
    trackerProject,
    runnerProject: repoA,
    agent,
    ...extra,
  });
}

function assignOk(db: Database, key: string): RunId {
  const result = assign(db, key);
  if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
  return result.run.id;
}

function change(db: Database, id: RunId, to: RunStateChange): void {
  const result = changeRunState(db, id, to);
  if (!result.ok) throw new Error(`transition failed: ${JSON.stringify(result.error)}`);
}

function moveTo(db: Database, id: RunId, state: RunState): void {
  if (state === "queued") return;
  change(db, id, { to: "running", started });
  if (state === "waiting-for-input" || state === "disconnected") change(db, id, { to: state });
  if (state === "ended")
    change(db, id, { to: "ended", agentResult: "reported-success", prState: "merged" });
}

describe("assignRun", () => {
  it("러너 쪽 프로젝트가 있는 Online 러너 중 남은 capacity가 가장 많은 러너를 적는다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "offline-big", capacity: 9, online: false, projects: [repoA] });
    addRunner(db, { id: "other-project", capacity: 9, online: true, projects: [repoB] });
    const busy = addRunner(db, { id: "busy", capacity: 3, online: true, projects: [repoA] });
    const roomy = addRunner(db, {
      id: "roomy",
      capacity: 2,
      online: true,
      projects: [repoA, repoB],
    });

    for (const key of ["X-1", "X-2"]) {
      const result = assign(db, key, { runnerId: busy });
      if (!result.ok) throw new Error(result.reason);
      moveTo(db, result.run.id, "running");
    }

    const result = assign(db, "ENG-1");
    expect(result.ok && result.run).toMatchObject({
      state: "queued",
      runnerId: roomy,
      workspaceId: "ws-1",
      worktreeName: "ganger-ENG-1-1",
    });
  });

  it("맞는 Online 러너가 없으면 러너 없이 Queued로 만든다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "offline", capacity: 2, online: false, projects: [repoA] });
    const result = assign(db, "ENG-1");
    expect(result.ok && result.run).toMatchObject({ state: "queued", runnerId: null });
  });

  it("운영자가 고른 러너를 그대로 쓴다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "roomy", capacity: 5, online: true, projects: [repoA] });
    const chosen = addRunner(db, { id: "chosen", capacity: 1, online: false, projects: [] });
    const result = assign(db, "ENG-1", { runnerId: chosen });
    expect(result.ok && result.run.runnerId).toBe(chosen);
  });

  it("GitHub 인증이 깨진 러너는 고르지 않고, 운영자도 고를 수 없다 (Q82.14·Q87)", () => {
    const db = seededDatabase();
    const broken = addRunner(db, {
      id: "broken",
      capacity: 9,
      online: true,
      projects: [repoA],
      assignmentBlocked: true,
    });

    expect(assign(db, "ENG-1")).toMatchObject({ ok: true, run: { runnerId: null } });
    expect(assign(db, "ENG-2", { runnerId: broken })).toEqual({
      ok: false,
      reason: "runner-assignment-blocked",
    });
  });

  it.each<RunState>(["queued", "running", "waiting-for-input", "disconnected"])(
    "%s 런이 있는 티켓에는 런을 만들지 않는다",
    (state) => {
      const db = seededDatabase();
      addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
      const id = assignOk(db, "ENG-1");
      moveTo(db, id, state);

      expect(assign(db, "ENG-1")).toEqual({ ok: false, reason: "active-run" });
      const count = db.$client.prepare("SELECT count(*) AS n FROM runs").get()?.["n"];
      expect(count).toBe(1);
    },
  );

  it("Ended 뒤에는 새 런을 만들고 런 번호를 올린다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
    moveTo(db, assignOk(db, "ENG-1"), "ended");
    const result = assign(db, "ENG-1");
    expect(result.ok && result.run.worktreeName).toBe("ganger-ENG-1-2");
  });

  it("다른 트래커 연결이나 다른 티켓의 런은 막지 않는다", () => {
    const db = seededDatabase();
    assignOk(db, "ENG-1");
    expect(assign(db, "ENG-2").ok).toBe(true);
  });

  it("다른 트래커 연결의 같은 티켓 키도 워크트리 이름이 겹치지 않는다", () => {
    const db = seededDatabase();
    const other = toTrackerConnectionId("conn-2");
    saveTrackerConnection(db, new SecretBox(KEY), {
      id: other,
      kind: toTrackerKind("fake"),
      name: "Other",
      config: {},
      secrets: {},
    });
    saveWorkspaceTrackerProject(db, {
      workspaceId,
      connection: other,
      projectId: trackerProject,
      name: "Other web",
      inProgressStateId: null,
    });
    assignOk(db, "ENG-1");
    const result = assignRun(db, {
      ticket: { connection: other, key: toTicketKey("ENG-1") },
      trackerProject,
      runnerProject: repoA,
      agent,
    });
    expect(result.ok && result.run.worktreeName).toBe("ganger-ENG-1-2");
  });

  it("DB도 티켓당 Ended가 아닌 런을 하나로 막는다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(() =>
      db.$client
        .prepare(
          `INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
             runner_project_id, agent_id, worktree_name, state, assigned_at)
           SELECT 'dup', tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
             runner_project_id, agent_id, 'b', 'queued', 0 FROM runs WHERE id = ?`,
        )
        .run(id),
    ).toThrow(/UNIQUE/);
  });

  it("Workspace에 묶이지 않은 트래커 프로젝트는 거부한다", () => {
    const db = seededDatabase();
    const result = assignRun(db, {
      ticket: ticket("ENG-1"),
      trackerProject: toTrackerProjectId("elsewhere"),
      runnerProject: repoA,
      agent,
    });
    expect(result).toEqual({ ok: false, reason: "unknown-tracker-project" });
  });

  it("할당을 상태 이력에 남긴다", () => {
    const db = seededDatabase();
    const now = new Date("2026-11-17T00:00:00Z");
    const result = assignRun(db, {
      ticket: ticket("ENG-1"),
      trackerProject,
      runnerProject: repoA,
      agent,
      now,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(listRunStateChanges(db, result.run.id)).toEqual([{ from: null, to: "queued", at: now }]);
  });
});

describe("Run 테이블과 두 축", () => {
  it("요약 결과·Failed 사유·워크트리 처리 컬럼이 없다", () => {
    const db = seededDatabase();
    const columns = db.$client
      .prepare("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((row) => String(row["name"]));
    expect(columns).toEqual(expect.arrayContaining(["agent_result", "pr_state", "later_pr_state"]));
    for (const column of columns) {
      expect(column).not.toMatch(/summary|outcome|reason|disposition|verdict/);
    }
  });

  it.each(
    AGENT_RESULTS.filter((r) => r !== "could-not-start").flatMap((agentResult) =>
      PR_STATES.map((prState) => ({ agentResult, prState })),
    ),
  )("시작한 런의 두 축 $agentResult + $prState 을 저장하고 읽는다", ({ agentResult, prState }) => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    change(db, id, { to: "running", started });
    change(db, id, { to: "ended", agentResult, prState });

    const stored = getRunWithRecords(db, id)?.run;
    expect(stored).toMatchObject({
      state: "ended",
      agentResult,
      prState,
      runnerUnreached: false,
      ...started,
    });
    if (stored?.state !== "ended") throw new Error("not ended");
    expect(summarizeRunOutcome(stored)).toEqual(
      summarizeRunOutcome({ agentResult, prState, runnerUnreached: false }),
    );
  });

  it("Queued에서 취소해 러너·워크트리·시작 시각 없이 PR 상태 없음으로 끝난 런을 저장한다 (Q77·Q82.10)", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    change(db, id, { to: "ended", agentResult: "canceled", prState: "none" });
    expect(changeRunState(db, id, { to: "running" })).toMatchObject({ ok: false });

    const stored = getRunWithRecords(db, id)?.run;
    expect(stored).toMatchObject({
      state: "ended",
      runnerId: null,
      worktree: null,
      branch: null,
      agentRef: null,
      startedAt: null,
      agentResult: "canceled",
      prState: "none",
      runnerUnreached: false,
    });
    expect(stored?.state === "ended" && stored.endedAt).toBeInstanceOf(Date);
    if (stored?.state !== "ended") throw new Error("not ended");
    expect(summarizeRunOutcome(stored)).toEqual({ outcome: "canceled", worktree: "remove-now" });
  });

  it("시작할 수 없음으로 끝낸 런은 시작 오류를 남긴다 (Q82.16·Q86)", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    expect(recordStartFailure(db, id, { failures: 4, error: "runner_error: boom" })).toBe(true);
    change(db, id, { to: "ended", agentResult: "could-not-start", prState: "none" });

    const found = getRunWithRecords(db, id);
    expect(found?.run).toMatchObject({ agentResult: "could-not-start", startedAt: null });
    expect(found?.records).toMatchObject({ startFailures: 4, startError: "runner_error: boom" });
  });

  it("시작하지 않은 런을 시작한 런의 결과로 끝내거나, 시작한 런을 시작할 수 없음으로 끝낼 수 없다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 2, online: true, projects: [repoA] });
    const queued = assignOk(db, "ENG-1");
    for (const bad of [
      { agentResult: "timed-out", prState: "none" },
      { agentResult: "canceled", prState: "open" },
    ] as const) {
      expect(changeRunState(db, queued, { to: "ended", ...bad })).toEqual({
        ok: false,
        error: { kind: "axes-mismatch" },
      });
    }
    const running = assignOk(db, "ENG-2");
    moveTo(db, running, "running");
    expect(
      changeRunState(db, running, { to: "ended", agentResult: "could-not-start", prState: "none" }),
    ).toEqual({ ok: false, error: { kind: "axes-mismatch" } });
    expect(
      changeRunState(db, running, {
        to: "ended",
        agentResult: "runner-disconnected",
        prState: "none",
        runnerUnreached: true,
      }),
    ).toEqual({ ok: false, error: { kind: "axes-mismatch" } });
  });

  it("러너에 닿지 못한 채 끝난 취소 런을 기록한다 (Q82.21)", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    moveTo(db, id, "disconnected");
    change(db, id, {
      to: "ended",
      agentResult: "canceled",
      prState: "open",
      runnerUnreached: true,
    });

    const stored = getRunWithRecords(db, id)?.run;
    if (stored?.state !== "ended") throw new Error("not ended");
    expect(stored.runnerUnreached).toBe(true);
    expect(summarizeRunOutcome(stored)).toEqual({
      outcome: "canceled",
      worktree: "operator-decides",
    });
  });

  it("완료 보고 본문을 함께 남긴다 (Q82.2)", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    moveTo(db, id, "running");
    change(db, id, {
      to: "ended",
      agentResult: "reported-failure",
      prState: "open",
      reportBody: "테스트가 깨져 멈췄어요",
    });

    expect(getRunWithRecords(db, id)?.records.reportBody).toBe("테스트가 깨져 멈췄어요");
  });

  it("Ended가 아닌 런에는 두 축을 넣을 수 없다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(() =>
      db.$client.prepare("UPDATE runs SET agent_result = 'reported-success' WHERE id = ?").run(id),
    ).toThrow(/CHECK/);
  });
});

describe("changeRunState", () => {
  it("core 전이 표에 없는 전이를 거부한다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    expect(changeRunState(db, id, { to: "disconnected" })).toEqual({
      ok: false,
      error: { kind: "invalid-transition", from: "queued", to: "disconnected" },
    });
    moveTo(db, id, "ended");
    expect(changeRunState(db, id, { to: "running" })).toMatchObject({ ok: false });
  });

  it("러너가 없는 Queued 런은 시작하지 않는다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(changeRunState(db, id, { to: "running", started })).toEqual({
      ok: false,
      error: { kind: "no-runner" },
    });
  });

  it("Waiting for Input·Disconnected에 들어가고 나온 시각을 이력에 남긴다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 0, minute));
    changeRunState(db, id, { to: "running", started }, at(1));
    changeRunState(db, id, { to: "waiting-for-input" }, at(2));
    changeRunState(db, id, { to: "disconnected" }, at(3));
    changeRunState(db, id, { to: "running" }, at(4));
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: "reported-failure", prState: "open" },
      at(5),
    );

    expect(listRunStateChanges(db, id).slice(1)).toEqual([
      { from: "queued", to: "running", at: at(1) },
      { from: "running", to: "waiting-for-input", at: at(2) },
      { from: "waiting-for-input", to: "disconnected", at: at(3) },
      { from: "disconnected", to: "running", at: at(4) },
      { from: "running", to: "ended", at: at(5) },
    ]);
    expect(getRunWithRecords(db, id)?.run).toMatchObject({ startedAt: at(1), endedAt: at(5) });
  });

  it("Queued 런의 러너를 비우고 다시 정해도 할당 시각(대기열 자리)은 그대로다", () => {
    const db = seededDatabase();
    const runner = addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    const before = getRunWithRecords(db, id)?.run.assignedAt;
    expect(setQueuedRunRunner(db, id, null)).toBe(true);
    expect(setQueuedRunRunner(db, id, runner)).toBe(true);
    expect(getRunWithRecords(db, id)?.run).toMatchObject({ runnerId: runner, assignedAt: before });
    moveTo(db, id, "running");
    expect(setQueuedRunRunner(db, id, null)).toBe(false);
  });
});

describe("updateRunRecords", () => {
  it("상태 밖의 기록을 저장하고 읽는다. 로그는 마지막 200줄만 남긴다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    moveTo(db, id, "ended");
    const at = new Date("2026-11-17T01:00:00Z");
    const log = Array.from({ length: 250 }, (_, i) => `line ${i}`);

    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("PR_1"),
        displayId: "#7",
        url: "https://example.com/pr/7",
        ci: "pending",
        checkedAt: at,
      },
      laterPrState: { state: "merged", at },
      worktreeRemovedAt: at,
      unreachableSince: null,
      lastLog: log,
    });

    const records = getRunWithRecords(db, id)?.records;
    expect(records).toMatchObject({
      pullRequest: { displayId: "#7", ci: "pending", checkedAt: at },
      laterPrState: { state: "merged", at },
      worktreeRemovedAt: at,
      unreachableSince: null,
    });
    expect(records?.lastLog).toHaveLength(200);
    expect(records?.lastLog?.[0]).toBe("line 50");
  });

  it("이후 PR 상태는 Ended 런에만 적는다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    let caught: unknown;
    try {
      updateRunRecords(db, id, { laterPrState: { state: "merged", at: new Date() } });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof Error ? String(caught.cause) : "").toMatch(/CHECK/);
  });
});

describe("listRuns 의 순서와 상한", () => {
  function assignAt(db: Database, key: string, minute: number): RunId {
    const result = assignRun(db, {
      ticket: ticket(key),
      trackerProject,
      runnerProject: repoA,
      agent,
      now: new Date(Date.UTC(2026, 10, 17, 0, minute)),
    });
    if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
    return result.run.id;
  }

  it("기본은 할당 순서이고, 새 것부터 상한만큼만 읽을 수 있다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
    const ids = ["ENG-1", "ENG-2", "ENG-3", "ENG-4"].map((key, i) => assignAt(db, key, i));
    for (const id of ids.slice(0, 3)) moveTo(db, id, "ended");

    expect(listRuns(db).map((run) => run.id)).toEqual(ids);
    expect(
      listRuns(db, { states: ["ended"], order: "newest", limit: 2 }).map((run) => run.id),
    ).toEqual([ids[2], ids[1]]);
    expect(listRuns(db, { limit: 0 })).toEqual([]);
  });

  it("티켓마다 마지막 런만 읽을 수 있다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
    const first = assignAt(db, "ENG-1", 0);
    moveTo(db, first, "ended");
    const second = assignAt(db, "ENG-1", 1);
    moveTo(db, second, "ended");
    const other = assignAt(db, "ENG-2", 2);

    expect(listRuns(db, { latestPerTicket: true }).map((run) => run.id)).toEqual([second, other]);
    expect(listRuns(db, { latestPerTicket: true, states: ["ended"] }).map((run) => run.id)).toEqual(
      [second],
    );
  });

  it("끝난 런을 두 축과 이후 PR 상태로 거를 수 있다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
    const merged = assignAt(db, "ENG-1", 0);
    moveTo(db, merged, "ended");
    const open = assignAt(db, "ENG-2", 1);
    change(db, open, { to: "running", started });
    change(db, open, { to: "ended", agentResult: "reported-success", prState: "open" });
    const settled = assignAt(db, "ENG-3", 2);
    change(db, settled, { to: "running", started });
    change(db, settled, { to: "ended", agentResult: "reported-success", prState: "open" });
    updateRunRecords(db, settled, { laterPrState: { state: "merged", at: new Date() } });

    const openAxes = { agentResult: "reported-success", prState: "open" } as const;
    expect(listRuns(db, { endedAxes: [openAxes] }).map((run) => run.id)).toEqual([open, settled]);
    expect(
      listRuns(db, { endedAxes: [{ ...openAxes, laterPrState: null }] }).map((run) => run.id),
    ).toEqual([open]);
    expect(listRuns(db, { endedAxes: [] })).toEqual([]);
  });

  it("러너·트래커 프로젝트·에이전트·끝난 시각으로 거를 수 있다", () => {
    const db = seededDatabase();
    const unassigned = assignOk(db, "ENG-4");
    change(db, unassigned, { to: "ended", agentResult: "could-not-start", prState: "none" });
    const runnerA = addRunner(db, { id: "a", capacity: 5, online: true, projects: [repoA] });
    const runnerB = addRunner(db, { id: "b", capacity: 5, online: true, projects: [repoA] });
    const endAt = (
      key: string,
      minute: number,
      extra: { runnerId?: RunnerId; agent?: AgentId },
    ) => {
      const result = assignRun(db, {
        ticket: ticket(key),
        trackerProject,
        runnerProject: repoA,
        agent: extra.agent ?? agent,
        ...(extra.runnerId === undefined ? {} : { runnerId: extra.runnerId }),
        now: new Date(Date.UTC(2026, 10, 17, 0, minute)),
      });
      if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
      const at = new Date(Date.UTC(2026, 10, 17, 1, minute));
      const ended = changeRunState(db, result.run.id, { to: "running", started }, at);
      if (!ended.ok) throw new Error("start failed");
      const done = changeRunState(
        db,
        result.run.id,
        { to: "ended", agentResult: "reported-success", prState: "merged" },
        at,
      );
      if (!done.ok) throw new Error("end failed");
      return result.run.id;
    };
    const onA = endAt("ENG-1", 0, { runnerId: runnerA });
    const onB = endAt("ENG-2", 10, { runnerId: runnerB });
    const codex = endAt("ENG-3", 20, { runnerId: runnerA, agent: toAgentId("codex") });
    const ids = (filter: Parameters<typeof listRuns>[1]) =>
      listRuns(db, filter).map((run) => run.id);

    expect(ids({ runnerId: runnerA })).toEqual([onA, codex]);
    expect(ids({ runnerId: null })).toEqual([unassigned]);
    expect(ids({ agent: toAgentId("codex") })).toEqual([codex]);
    expect(ids({ trackerProject: { connection, project: trackerProject } })).toHaveLength(4);
    expect(
      ids({ trackerProject: { connection, project: toTrackerProjectId("tp-other") } }),
    ).toEqual([]);
    expect(
      ids({
        endedBetween: {
          from: new Date(Date.UTC(2026, 10, 17, 1, 5)),
          before: new Date(Date.UTC(2026, 10, 17, 1, 20)),
        },
      }),
    ).toEqual([onB]);
    expect(ids({ runnerId: runnerA, agent: agent, states: ["ended"] })).toEqual([onA]);
  });

  it("listRunsWithRecords 는 런과 기록을 한 번에 돌려준다", () => {
    const db = seededDatabase();
    const id = assignAt(db, "ENG-1", 0);
    const at = new Date("2026-11-17T03:00:00Z");
    updateRunRecords(db, id, { worktreeRemovedAt: at });
    expect(listRunsWithRecords(db, { workspaceId })).toEqual([getRunWithRecords(db, id)]);
  });
});

describe("recordStartRequested", () => {
  it("시작을 처음 보내기 직전에 한 번만 적는다(시작 멱등)", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    const first = new Date("2026-11-17T01:00:00Z");
    expect(recordStartRequested(db, id, first)).toBe(true);
    expect(recordStartRequested(db, id, new Date("2026-11-17T02:00:00Z"))).toBe(false);
    expect(getRunWithRecords(db, id)?.records.startRequestedAt).toEqual(first);
  });
});

describe("런 취소 요청 (Q77·Q82.8)", () => {
  it.each<RunState>(["queued", "running", "waiting-for-input", "disconnected"])(
    "%s 런의 취소 요청은 받아들인다",
    (state) => {
      const db = seededDatabase();
      addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
      const id = assignOk(db, "ENG-1");
      moveTo(db, id, state);
      const at = new Date("2026-11-17T01:00:00Z");

      expect(requestRunCancel(db, id, at)).toEqual({ ok: true, requestedAt: at });
      expect(hasPendingCancelRequest(db, id)).toBe(true);
    },
  );

  it("Ended 런의 취소 요청은 거부한다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    moveTo(db, id, "ended");

    expect(requestRunCancel(db, id)).toEqual({ ok: false, reason: "already-ended" });
    expect(listPendingCancelRequests(db)).toEqual([]);
  });

  it("요청을 남기고 한 번만 꺼내 처리 표시를 한다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    const first = new Date("2026-11-17T01:00:00Z");
    requestRunCancel(db, id, first);
    expect(requestRunCancel(db, id, new Date("2026-11-17T02:00:00Z"))).toEqual({
      ok: true,
      requestedAt: first,
    });
    expect(listPendingCancelRequests(db)).toEqual([{ runId: id, requestedAt: first }]);

    expect(getRunCancelRequest(db, id)).toEqual({ requestedAt: first, processedAt: null });
    const processedAt = new Date("2026-11-17T03:00:00Z");
    expect(markCancelRequestProcessed(db, id, processedAt)).toBe(true);
    expect(markCancelRequestProcessed(db, id)).toBe(false);
    expect(getRunCancelRequest(db, id)).toEqual({ requestedAt: first, processedAt });
    expect(getRunCancelRequest(db, toRunId("missing"))).toBeNull();
    expect(listPendingCancelRequests(db)).toEqual([]);
    expect(hasPendingCancelRequest(db, id)).toBe(false);
  });

  it("없는 런의 취소는 거부한다", () => {
    const db = seededDatabase();
    expect(requestRunCancel(db, toRunId("missing"))).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("질문과 답 요청 (Q82.3·Q82.5)", () => {
  it("질문을 한 번만 쓰고, 답을 남기고, 보낼 답을 한 번만 꺼내 처리 표시를 한다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    moveTo(db, id, "waiting-for-input");
    const q = toQuestionId("msg-1");
    const askedAt = new Date("2026-11-17T01:00:00Z");
    const question = { id: q, body: "A와 B 중 무엇?", options: ["A", "B"], askedAt };

    expect(recordRunQuestions(db, id, [question])).toBe(1);
    expect(recordRunQuestions(db, id, [question])).toBe(0);
    expect(listUnsentAnswers(db)).toEqual([]);

    const answeredAt = new Date("2026-11-17T01:05:00Z");
    expect(answerRunQuestion(db, { runId: id, questionId: q, answer: "A" }, answeredAt)).toEqual({
      ok: true,
    });
    expect(answerRunQuestion(db, { runId: id, questionId: q, answer: "B" })).toEqual({
      ok: false,
      reason: "already-answered",
    });
    expect(listUnsentAnswers(db)).toEqual([{ runId: id, questionId: q, answer: "A", answeredAt }]);
    expect(sentQuestionIds(db, id).size).toBe(0);

    expect(markAnswerSent(db, { runId: id, questionId: q })).toBe(true);
    expect(markAnswerSent(db, { runId: id, questionId: q })).toBe(false);
    expect(listUnsentAnswers(db)).toEqual([]);
    expect([...sentQuestionIds(db, id)]).toEqual([q]);
    expect(listRunQuestions(db, id)).toMatchObject([
      { id: q, body: "A와 B 중 무엇?", options: ["A", "B"], answer: { text: "A", answeredAt } },
    ]);
  });

  it("받지 않은 질문에는 답할 수 없다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(
      answerRunQuestion(db, { runId: id, questionId: toQuestionId("x"), answer: "A" }),
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("recordTrackerEvent", () => {
  it("같은 중복 제거 키는 한 번만 기록한다", () => {
    const db = seededDatabase();
    const event = {
      deliveryId: toDeliveryId("delivery-1"),
      kind: "ticket.updated" as const,
      ticketKey: toTicketKey("ENG-1"),
      projectId: trackerProject,
      labelIds: [toLabelId("auto")],
      previousLabelIds: [],
      receivedAt: new Date(0),
    };
    expect(recordTrackerEvent(db, connection, event)).toBe("recorded");
    expect(recordTrackerEvent(db, connection, event)).toBe("duplicate");
    expect(listUnprocessedTrackerEvents(db)).toMatchObject([
      { labelIds: ["auto"], previousLabelIds: [] },
    ]);
    expect(markTrackerEventProcessed(db, connection, event.deliveryId)).toBe(true);
    expect(listUnprocessedTrackerEvents(db)).toHaveLength(0);
  });
});

describe("inTransaction", () => {
  it("중첩하면 안쪽 실패만 되돌리고 바깥은 이어 간다", () => {
    const db = seededDatabase();
    inTransaction(db, () => {
      assignOk(db, "ENG-1");
      expect(() =>
        inTransaction(db, () => {
          assignOk(db, "ENG-2");
          throw new Error("inner");
        }),
      ).toThrow("inner");
    });
    expect(
      db.$client
        .prepare("SELECT ticket_key FROM runs")
        .all()
        .map((r) => r["ticket_key"]),
    ).toEqual(["ENG-1"]);
  });
});
