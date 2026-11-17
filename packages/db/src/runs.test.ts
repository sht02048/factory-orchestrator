import {
  AGENT_RESULTS,
  PR_STATES,
  summarizeRunOutcome,
  toDeliveryId,
  toPullRequestId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import type { RunId, RunState, TicketRef } from "@factory/core";
import { describe, expect, it } from "vitest";
import type { Database } from "./database.js";
import {
  listUnprocessedTrackerEvents,
  markTrackerEventProcessed,
  recordTrackerEvent,
} from "./events.js";
import {
  assignRun,
  changeRunState,
  getRunWithRecords,
  listRunStateChanges,
  setQueuedRunRunner,
  updateRunRecords,
} from "./runs.js";
import type { RunStateChange } from "./runs.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  repoB,
  seededDatabase,
  trackerProject,
} from "./test-fixtures.js";

const ticket = (key: string): TicketRef => ({ connection, key: toTicketKey(key) });
const worktree = toWorktreeRef("repo::/wt/1");

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

/** 런을 원하는 상태까지 옮긴다 */
function moveTo(db: Database, id: RunId, state: RunState): void {
  if (state === "queued") return;
  change(db, id, { to: "running", worktree });
  if (state === "waiting-for-input" || state === "disconnected") change(db, id, { to: state });
  if (state === "ended")
    change(db, id, { to: "ended", agentResult: "exited-normally", prState: "merged" });
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

    // busy에 런 둘을 올려 남은 capacity를 1로 만든다(roomy는 2).
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
      branch: "factory/ENG-1-1",
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

  it.each<RunState>(["queued", "running", "waiting-for-input", "disconnected"])(
    "%s 런이 있는 티켓에는 런을 만들지 않는다",
    (state) => {
      const db = seededDatabase();
      addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
      const id = assignOk(db, "ENG-1");
      moveTo(db, id, state);

      expect(assign(db, "ENG-1")).toEqual({ ok: false, reason: "active-run" });
      const count = db.prepare("SELECT count(*) AS n FROM runs").get()?.["n"];
      expect(count).toBe(1);
    },
  );

  it("Ended 뒤에는 새 런을 만들고 런 번호를 올린다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 5, online: true, projects: [repoA] });
    moveTo(db, assignOk(db, "ENG-1"), "ended");
    const result = assign(db, "ENG-1");
    expect(result.ok && result.run.branch).toBe("factory/ENG-1-2");
  });

  it("다른 트래커 연결이나 다른 티켓의 런은 막지 않는다", () => {
    const db = seededDatabase();
    assignOk(db, "ENG-1");
    expect(assign(db, "ENG-2").ok).toBe(true);
  });

  it("DB도 티켓당 Ended가 아닌 런을 하나로 막는다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(() =>
      db
        .prepare(
          `INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
             runner_project_id, agent_id, branch, state, assigned_at)
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
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((row) => String(row["name"]));
    expect(columns).toEqual(expect.arrayContaining(["agent_result", "pr_state", "later_pr_state"]));
    for (const column of columns) {
      expect(column).not.toMatch(/summary|outcome|reason|disposition|verdict/);
    }
  });

  it.each(
    AGENT_RESULTS.flatMap((agentResult) => PR_STATES.map((prState) => ({ agentResult, prState }))),
  )("두 축 $agentResult + $prState 을 저장하고 읽는다", ({ agentResult, prState }) => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    change(db, id, { to: "running", worktree });
    change(db, id, { to: "ended", agentResult, prState });

    const stored = getRunWithRecords(db, id)?.run;
    expect(stored).toMatchObject({ state: "ended", agentResult, prState });
    if (stored?.state !== "ended") throw new Error("not ended");
    // 요약 결과는 저장하지 않고 core 계산 함수로 얻는다.
    expect(summarizeRunOutcome(stored.agentResult, stored.prState)).toEqual(
      summarizeRunOutcome(agentResult, prState),
    );
  });

  it("Ended가 아닌 런에는 두 축을 넣을 수 없다", () => {
    const db = seededDatabase();
    const id = assignOk(db, "ENG-1");
    expect(() =>
      db.prepare("UPDATE runs SET agent_result = 'exited-normally' WHERE id = ?").run(id),
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
    expect(changeRunState(db, id, { to: "running", worktree })).toEqual({
      ok: false,
      error: { kind: "no-runner" },
    });
  });

  it("Waiting for Input·Disconnected에 들어가고 나온 시각을 이력에 남긴다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "r", capacity: 1, online: true, projects: [repoA] });
    const id = assignOk(db, "ENG-1");
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 0, minute));
    changeRunState(db, id, { to: "running", worktree }, at(1));
    changeRunState(db, id, { to: "waiting-for-input" }, at(2));
    changeRunState(db, id, { to: "disconnected" }, at(3));
    changeRunState(db, id, { to: "running" }, at(4));
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: "exited-with-error", prState: "open" },
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
    expect(() =>
      updateRunRecords(db, id, { laterPrState: { state: "merged", at: new Date() } }),
    ).toThrow(/CHECK/);
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
      labelIds: null,
      previous: null,
      receivedAt: new Date(0),
    };
    expect(recordTrackerEvent(db, connection, event)).toBe("recorded");
    expect(recordTrackerEvent(db, connection, event)).toBe("duplicate");
    expect(listUnprocessedTrackerEvents(db)).toHaveLength(1);
    expect(markTrackerEventProcessed(db, connection, event.deliveryId)).toBe(true);
    expect(listUnprocessedTrackerEvents(db)).toHaveLength(0);
  });
});
