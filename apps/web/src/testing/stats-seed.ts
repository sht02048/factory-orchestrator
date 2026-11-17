import {
  toAgentId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import type { AgentResult, PrState, RunnerId } from "@factory/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
  updateRunRecords,
} from "@factory/db";
import type { Database } from "@factory/db";

/*
 * Stats 테스트 DB. 가상 값만 쓴다(acme). 지표 값은 stats/load.test.ts 가 손으로 계산해 둔다.
 *
 * - Workspace 둘: ws-commerce(트래커 프로젝트 Web, API), ws-labs(트래커 프로젝트 Lab)
 * - 러너 둘: runner-a, runner-b(둘 다 acme/web 이 있다). 에이전트 둘: claude, codex
 * - 기준 시각 now 는 2026-11-17 12:00 UTC 라 기간은 11월 4일~17일(UTC)이다.
 * - ws-commerce 의 기간 안 Ended 런 아홉(statsCases)과, 세지 않는 런 셋(기간 전에 끝남, 실행 중,
 *   다른 Workspace)을 둔다.
 */

const connection = toTrackerConnectionId("conn-acme");
export const commerce = toWorkspaceId("ws-commerce");
export const labs = toWorkspaceId("ws-labs");
const projects = {
  Web: toTrackerProjectId("tp-web"),
  API: toTrackerProjectId("tp-api"),
  Lab: toTrackerProjectId("tp-lab"),
} as const;
const repo = toRunnerProjectId("github:acme/web");
const runnerIds = { "runner-a": toRunnerId("runner-a"), "runner-b": toRunnerId("runner-b") };

export const now = new Date("2026-11-17T12:00:00Z");

export interface StatsCase {
  key: string;
  project: keyof typeof projects;
  runner: keyof typeof runnerIds;
  agent: "claude" | "codex";
  agentResult: AgentResult;
  prState: PrState;
  laterPrState: "merged" | "closed" | null;
  /** 할당 시각(UTC ISO) */
  assignedAt: string;
  /** 할당부터 시작까지, 시작부터 종료까지(분) */
  waitMinutes: number;
  executionMinutes: number;
}

/** 기간 안에 끝난 ws-commerce 런. 끝난 날은 할당 날과 같고, C-7 만 11월 3일에 할당해 4일에 끝난다 */
export const statsCases: ReadonlyArray<StatsCase> = [
  {
    key: "C-1",
    project: "Web",
    runner: "runner-a",
    agent: "claude",
    agentResult: "exited-normally",
    prState: "merged",
    laterPrState: null,
    assignedAt: "2026-11-16T09:00:00Z",
    waitMinutes: 2,
    executionMinutes: 20,
  },
  {
    key: "C-2",
    project: "Web",
    runner: "runner-a",
    agent: "claude",
    agentResult: "exited-with-error",
    prState: "open",
    laterPrState: "merged",
    assignedAt: "2026-11-16T10:00:00Z",
    waitMinutes: 4,
    executionMinutes: 30,
  },
  {
    key: "C-3",
    project: "Web",
    runner: "runner-b",
    agent: "codex",
    agentResult: "exited-normally",
    prState: "open",
    laterPrState: "closed",
    assignedAt: "2026-11-15T09:00:00Z",
    waitMinutes: 10,
    executionMinutes: 40,
  },
  {
    key: "C-4",
    project: "API",
    runner: "runner-a",
    agent: "codex",
    agentResult: "exited-normally",
    prState: "open",
    laterPrState: null,
    assignedAt: "2026-11-15T10:00:00Z",
    waitMinutes: 6,
    executionMinutes: 24,
  },
  {
    key: "C-5",
    project: "API",
    runner: "runner-b",
    agent: "claude",
    agentResult: "timed-out",
    prState: "open",
    laterPrState: null,
    assignedAt: "2026-11-14T09:00:00Z",
    waitMinutes: 1,
    executionMinutes: 120,
  },
  {
    key: "C-6",
    project: "API",
    runner: "runner-b",
    agent: "claude",
    agentResult: "exited-with-error",
    prState: "none",
    laterPrState: null,
    assignedAt: "2026-11-10T09:00:00Z",
    waitMinutes: 3,
    executionMinutes: 15,
  },
  {
    key: "C-7",
    project: "Web",
    runner: "runner-a",
    agent: "codex",
    agentResult: "exited-normally",
    prState: "closed",
    laterPrState: null,
    assignedAt: "2026-11-03T23:55:00Z",
    waitMinutes: 5,
    executionMinutes: 10,
  },
  {
    key: "C-8",
    project: "Web",
    runner: "runner-a",
    agent: "claude",
    agentResult: "exited-normally",
    prState: "merged",
    laterPrState: null,
    assignedAt: "2026-11-17T09:00:00Z",
    waitMinutes: 8,
    executionMinutes: 12,
  },
  {
    key: "C-9",
    project: "Web",
    runner: "runner-b",
    agent: "claude",
    agentResult: "exited-with-error",
    prState: "none",
    laterPrState: null,
    assignedAt: "2026-11-12T09:00:00Z",
    waitMinutes: 2,
    executionMinutes: 8,
  },
];

/** 세지 않는 런: 기간 전(11월 3일)에 끝남 */
const beforePeriod: StatsCase = {
  key: "OLD-1",
  project: "Web",
  runner: "runner-a",
  agent: "claude",
  agentResult: "exited-normally",
  prState: "merged",
  laterPrState: null,
  assignedAt: "2026-11-03T20:00:00Z",
  waitMinutes: 1,
  executionMinutes: 10,
};

/** 세지 않는 런: 다른 Workspace */
const otherWorkspace: StatsCase = {
  key: "LAB-1",
  project: "Lab",
  runner: "runner-a",
  agent: "claude",
  agentResult: "exited-normally",
  prState: "merged",
  laterPrState: null,
  assignedAt: "2026-11-16T09:00:00Z",
  waitMinutes: 1,
  executionMinutes: 10,
};

/**
 * Stats 테스트 DB 를 만든다. path 를 주면 그 파일에 쓴다(화면을 눈으로 볼 때).
 */
export function seedStatsDatabase(options: { path?: string } = {}): Database {
  const at = (iso: string, plusMinutes = 0) =>
    new Date(new Date(iso).getTime() + plusMinutes * 60_000);
  const db = openDatabase(options.path ?? ":memory:");
  migrate(db);
  saveTrackerConnection(db, new SecretBox(new Uint8Array(32).fill(7)), {
    id: connection,
    kind: toTrackerKind("fake"),
    name: "Acme",
    config: {},
    secrets: {},
  });
  const created = at("2026-11-01T00:00:00Z");
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, created);
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, created);
  const workspaceOf: Record<keyof typeof projects, typeof commerce> = {
    Web: commerce,
    API: commerce,
    Lab: labs,
  };
  for (const name of ["Web", "API", "Lab"] as const) {
    saveWorkspaceTrackerProject(db, {
      workspaceId: workspaceOf[name],
      connection,
      projectId: projects[name],
      name,
      inProgressStateId: null,
    });
  }
  for (const id of Object.values(runnerIds)) addRunner(db, id, created);

  for (const c of [...statsCases, beforePeriod, otherWorkspace]) {
    const assignedAt = at(c.assignedAt);
    const run = mustRun(
      assignRun(db, {
        ticket: { connection, key: toTicketKey(c.key) },
        trackerProject: projects[c.project],
        runnerProject: repo,
        agent: toAgentId(c.agent),
        runnerId: runnerIds[c.runner],
        now: assignedAt,
      }),
    );
    mustRun(
      changeRunState(
        db,
        run.id,
        { to: "running", worktree: toWorktreeRef(`wt-${c.key}`) },
        at(c.assignedAt, c.waitMinutes),
      ),
    );
    mustRun(
      changeRunState(
        db,
        run.id,
        { to: "ended", agentResult: c.agentResult, prState: c.prState },
        at(c.assignedAt, c.waitMinutes + c.executionMinutes),
      ),
    );
    if (c.laterPrState !== null) {
      updateRunRecords(db, run.id, {
        laterPrState: {
          state: c.laterPrState,
          at: at(c.assignedAt, c.waitMinutes + c.executionMinutes + 60),
        },
      });
    }
  }

  // 세지 않는 런: 아직 실행 중
  const active = mustRun(
    assignRun(db, {
      ticket: { connection, key: toTicketKey("C-10") },
      trackerProject: projects.Web,
      runnerProject: repo,
      agent: toAgentId("claude"),
      runnerId: runnerIds["runner-a"],
      now: at("2026-11-17T11:00:00Z"),
    }),
  );
  mustRun(
    changeRunState(
      db,
      active.id,
      { to: "running", worktree: toWorktreeRef("wt-C-10") },
      at("2026-11-17T11:01:00Z"),
    ),
  );
  return db;
}

function addRunner(db: Database, id: RunnerId, at: Date): void {
  saveRunner(db, { id, kind: toRunnerKind("fake"), name: id, config: {}, capacity: 10 }, at);
  recordRunnerCheck(db, {
    runnerId: id,
    online: true,
    checkedAt: at,
    error: null,
    projects: [{ id: repo, displayName: repo, setupState: "ready" }],
  });
}

function mustRun<R>(result: { ok: true; run: R } | { ok: false }): R {
  if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result)}`);
  return result.run;
}
