import {
  toAgentId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toAgentRef,
  toWorktreeRef,
} from "@ganger/core";
import type { AgentResult, PrState, RunnerId } from "@ganger/core";
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
} from "@ganger/db";
import type { Database } from "@ganger/db";

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
  assignedAt: string;
  waitMinutes: number;
  executionMinutes: number;
}

export const statsCases: ReadonlyArray<StatsCase> = [
  {
    key: "C-1",
    project: "Web",
    runner: "runner-a",
    agent: "claude",
    agentResult: "reported-success",
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
    agentResult: "reported-failure",
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
    agentResult: "reported-success",
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
    agentResult: "reported-success",
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
    agentResult: "reported-failure",
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
    agentResult: "reported-success",
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
    agentResult: "reported-success",
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
    agentResult: "reported-failure",
    prState: "none",
    laterPrState: null,
    assignedAt: "2026-11-12T09:00:00Z",
    waitMinutes: 2,
    executionMinutes: 8,
  },
];

const beforePeriod: StatsCase = {
  key: "OLD-1",
  project: "Web",
  runner: "runner-a",
  agent: "claude",
  agentResult: "reported-success",
  prState: "merged",
  laterPrState: null,
  assignedAt: "2026-11-03T20:00:00Z",
  waitMinutes: 1,
  executionMinutes: 10,
};

const otherWorkspace: StatsCase = {
  key: "LAB-1",
  project: "Lab",
  runner: "runner-a",
  agent: "claude",
  agentResult: "reported-success",
  prState: "merged",
  laterPrState: null,
  assignedAt: "2026-11-16T09:00:00Z",
  waitMinutes: 1,
  executionMinutes: 10,
};

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
        { to: "running", started: startedOn(`wt-${c.key}`) },
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
      { to: "running", started: startedOn("wt-C-10") },
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
    assignmentBlocked: false,
  });
}

function mustRun<R>(result: { ok: true; run: R } | { ok: false }): R {
  if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result)}`);
  return result.run;
}

function startedOn(worktree: string) {
  return {
    worktree: toWorktreeRef(worktree),
    branch: `acme/${worktree}`,
    agentRef: toAgentRef(`agent-${worktree}`),
  };
}

export function addRunDecisionCases(db: Database): void {
  const at = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00Z`);
  const assign = (key: string, agent: string) =>
    mustRun(
      assignRun(db, {
        ticket: { connection, key: toTicketKey(key) },
        trackerProject: projects.Web,
        runnerProject: repo,
        agent: toAgentId(agent),
        runnerId: runnerIds["runner-a"],
        now: at("10:00"),
      }),
    );
  for (const [key, agentResult, end] of [
    ["X-1", "canceled", "10:20"],
    ["X-2", "could-not-start", "10:05"],
  ] as const) {
    const run = assign(key, "aider");
    mustRun(changeRunState(db, run.id, { to: "ended", agentResult, prState: "none" }, at(end)));
  }
  for (const [key, agentResult, prState] of [
    ["X-3", "ended-without-report", "none"],
    ["X-4", "canceled", "open"],
  ] as const) {
    const run = assign(key, "gemini");
    mustRun(
      changeRunState(db, run.id, { to: "running", started: startedOn(`wt-${key}`) }, at("10:01")),
    );
    mustRun(changeRunState(db, run.id, { to: "ended", agentResult, prState }, at("10:11")));
  }
}
