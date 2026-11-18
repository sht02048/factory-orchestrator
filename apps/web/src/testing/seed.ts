import {
  toAgentId,
  toPullRequestId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toAgentRef,
  toWorktreeRef,
} from "@factory/core";
import type { AgentResult, PrState, RunId, RunnerId, RunnerProjectId } from "@factory/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
  updateRunRecords,
} from "@factory/db";
import type { Database } from "@factory/db";

export const connection = toTrackerConnectionId("conn-acme");
export const commerce = toWorkspaceId("ws-commerce");
export const labs = toWorkspaceId("ws-labs");
const webProject = toTrackerProjectId("tp-web");
const labProject = toTrackerProjectId("tp-lab");
const webRepo = toRunnerProjectId("github:acme/web");
const labRepo = toRunnerProjectId("github:acme/lab");
const agent = toAgentId("claude");

export const T0 = new Date("2026-11-17T09:00:00Z");
export const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

export interface EndedCase {
  key: string;
  agentResult: AgentResult;
  prState: PrState;
  summary: "merged" | "human-check" | "failed";
}

export const endedCases: ReadonlyArray<EndedCase> = [
  { key: "ACME-1", agentResult: "reported-success", prState: "merged", summary: "merged" },
  { key: "ACME-2", agentResult: "reported-failure", prState: "open", summary: "human-check" },
  { key: "ACME-3", agentResult: "timed-out", prState: "closed", summary: "failed" },
  { key: "ACME-4", agentResult: "stopped-waiting-for-input", prState: "none", summary: "failed" },
  { key: "ACME-5", agentResult: "runner-disconnected", prState: "open", summary: "failed" },
  { key: "ACME-6", agentResult: "worktree-missing", prState: "none", summary: "failed" },
  { key: "ACME-7", agentResult: "reported-success", prState: "closed", summary: "failed" },
];

export const activeCases = [
  { key: "ACME-10", state: "running" },
  { key: "ACME-11", state: "waiting-for-input" },
  { key: "ACME-12", state: "disconnected" },
  { key: "ACME-13", state: "queued" },
] as const;

export const offlineQueuedKey = "ACME-14";

export const now = minutes(120);

export function seedDatabase(options: { path?: string; origin?: Date } = {}): {
  db: Database;
  ids: Map<string, RunId>;
} {
  const base = (options.origin ?? T0).getTime();
  const minutes = (n: number) => new Date(base + n * 60_000);
  const db = openDatabase(options.path ?? ":memory:");
  migrate(db);
  saveTrackerConnection(db, new SecretBox(new Uint8Array(32).fill(7)), {
    id: connection,
    kind: toTrackerKind("fake"),
    name: "Acme",
    config: {},
    secrets: {},
  });
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, minutes(0));
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, minutes(1));
  for (const [workspaceId, projectId, name] of [
    [commerce, webProject, "Web"],
    [labs, labProject, "Lab"],
  ] as const) {
    saveWorkspaceTrackerProject(db, {
      workspaceId,
      connection,
      projectId,
      name,
      inProgressStateId: null,
    });
  }
  saveMapping(db, { connection, trackerProject: webProject, runnerProject: webRepo, agent });
  addRunner(db, "runner-a", { online: true, capacity: 10, projects: [webRepo] }, minutes(0));
  addRunner(db, "runner-b", { online: false, capacity: 1, projects: [labRepo] }, minutes(0));

  const ids = new Map<string, RunId>();
  let clock = 0;
  const assign = (key: string, trackerProject = webProject, runnerProject = webRepo): RunId => {
    clock += 1;
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey(key) },
      trackerProject,
      runnerProject,
      agent,
      now: minutes(clock),
    });
    if (!result.ok) throw new Error(`assign ${key}: ${result.reason}`);
    ids.set(key, result.run.id);
    return result.run.id;
  };
  const start = (id: RunId, key: string) => {
    expectOk(
      changeRunState(
        db,
        id,
        { to: "running", started: startedOn(`wt-${key}`) },
        minutes(clock + 1),
      ),
    );
  };

  for (const c of endedCases) {
    const id = assign(c.key);
    start(id, c.key);
    expectOk(
      changeRunState(
        db,
        id,
        { to: "ended", agentResult: c.agentResult, prState: c.prState },
        minutes(clock + 30),
      ),
    );
    if (c.prState !== "none") {
      const number = c.key.split("-")[1] ?? "0";
      updateRunRecords(db, id, {
        pullRequest: {
          id: toPullRequestId(`pr-${number}`),
          displayId: `#${number}`,
          url: `https://example.com/acme/web/pull/${number}`,
          ci: "success",
          checkedAt: minutes(clock + 30),
        },
      });
    }
  }
  for (const c of activeCases) {
    const id = assign(c.key);
    if (c.state === "queued") continue;
    start(id, c.key);
    if (c.state !== "running")
      expectOk(changeRunState(db, id, { to: c.state }, minutes(clock + 2)));
  }
  assign(offlineQueuedKey, webProject, labRepo);

  const labId = assign("LAB-1", labProject, webRepo);
  start(labId, "LAB-1");
  return { db, ids };
}

function addRunner(
  db: Database,
  name: string,
  input: { online: boolean; capacity: number; projects: RunnerProjectId[] },
  at: Date,
): RunnerId {
  const id = toRunnerId(name);
  saveRunner(
    db,
    { id, kind: toRunnerKind("fake"), name, config: {}, capacity: input.capacity },
    at,
  );
  recordRunnerCheck(db, {
    runnerId: id,
    online: input.online,
    checkedAt: at,
    error: null,
    assignmentBlocked: false,
    projects: input.projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })),
  });
  return id;
}

function expectOk(result: { ok: boolean }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result)}`);
}

function startedOn(worktree: string) {
  return {
    worktree: toWorktreeRef(worktree),
    branch: `acme/${worktree}`,
    agentRef: toAgentRef(`agent-${worktree}`),
  };
}

export function breakGitHubAuth(db: Database): void {
  recordRunnerCheck(db, {
    runnerId: toRunnerId("runner-a"),
    online: true,
    checkedAt: T0,
    error: null,
    projects: null,
    assignmentBlocked: true,
    prerequisites: [
      { id: "service", name: "Orca service", satisfied: true, hint: null, blocksAssignment: false },
      {
        id: "github-push:github:acme/web",
        name: "GitHub push access: acme/web",
        satisfied: false,
        hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
        blocksAssignment: true,
      },
      {
        id: "github-push:github:acme/docs",
        name: "GitHub push access: acme/docs",
        satisfied: true,
        hint: null,
        blocksAssignment: true,
      },
    ],
  });
}

export function addUnreachedCanceledRun(db: Database, key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: webProject,
    runnerProject: labRepo,
    agent,
    runnerId: toRunnerId("runner-b"),
    now: minutes(60),
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const id = assigned.run.id;
  expectOk(changeRunState(db, id, { to: "running", started: startedOn(`wt-${key}`) }, minutes(61)));
  expectOk(changeRunState(db, id, { to: "disconnected" }, minutes(62)));
  expectOk(
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: "canceled", prState: "none", runnerUnreached: true },
      minutes(90),
    ),
  );
  return id;
}
