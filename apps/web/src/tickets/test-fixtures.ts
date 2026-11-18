import {
  AdapterError,
  AdapterRegistry,
  toAgentId,
  toAgentRef,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
  toWorktreeRef,
} from "@factory/core";
import type {
  AgentResult,
  Page,
  Paged,
  PrState,
  RunId,
  RunnerProjectId,
  TrackerProjectId,
  TrackerTicket,
} from "@factory/core";
import { FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@factory/db";
import type { Database } from "@factory/db";
import type { TicketsContext } from "./load";

export const connection = toTrackerConnectionId("conn-acme");
export const commerce = toWorkspaceId("ws-commerce");
export const labs = toWorkspaceId("ws-labs");
export const webProject = toTrackerProjectId("tp-web");
export const docsProject = toTrackerProjectId("tp-docs");
export const brokenProject = toTrackerProjectId("tp-broken");
export const labProject = toTrackerProjectId("tp-lab");
export const webRepo = toRunnerProjectId("github:acme/web");
export const labRepo = toRunnerProjectId("github:acme/lab");
export const autoLabel = toLabelId("label-factory");

export const T0 = new Date("2026-11-17T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
export const now = minutes(600);

const fakeKind = toTrackerKind("fake");

class TicketsTracker extends FakeTracker {
  override listProjectTickets(
    projectId: TrackerProjectId,
    page?: Page,
  ): Promise<Paged<TrackerTicket>> {
    if (projectId === brokenProject) {
      return Promise.reject(new AdapterError({ kind: "unauthorized" }));
    }
    return super.listProjectTickets(projectId, page);
  }
}

function ticket(
  key: string,
  project: { id: TrackerProjectId; name: string },
  updatedMinutes: number,
  labels: TrackerTicket["labels"] = [],
): TrackerTicket {
  return {
    key: toTicketKey(key),
    title: `${key} 제목`,
    body: "",
    url: `https://linear.example.com/acme/issue/${key}`,
    labels,
    project,
    state: { id: toTrackerStateId("st-todo"), name: "Todo", category: "unstarted" },
    updatedAt: minutes(updatedMinutes),
  };
}

export interface TicketsFixture {
  db: Database;
  tracker: FakeTracker;
  context: TicketsContext;
  ids: Map<string, RunId>;
}

export function setupTickets(): TicketsFixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const secretBox = new SecretBox(new Uint8Array(32).fill(7));
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: {},
  });
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, minutes(0));
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, minutes(1));
  for (const [workspaceId, projectId, name] of [
    [commerce, webProject, "Web"],
    [commerce, docsProject, "Docs"],
    [commerce, brokenProject, "Broken"],
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
  saveMapping(db, {
    connection,
    trackerProject: webProject,
    runnerProject: webRepo,
    agent: toAgentId("claude"),
    model: "sonnet",
  });
  saveMapping(db, {
    connection,
    trackerProject: labProject,
    runnerProject: labRepo,
    agent: toAgentId("codex"),
  });
  saveAutoAssignLabel(db, { workspaceId: commerce, connection, labelId: autoLabel });

  addRunner(db, "runner-a", { online: true, blocked: false, projects: [webRepo] });
  addRunner(db, "runner-b", { online: false, blocked: false, projects: [webRepo] });
  addRunner(db, "runner-c", { online: true, blocked: true, projects: [webRepo] });
  addRunner(db, "runner-d", { online: true, blocked: false, projects: [labRepo] });

  const tracker = new TicketsTracker(fakeKind);
  const web = { id: webProject, name: "Web" };
  for (const [key, updated] of [
    ["ACME-1", 10],
    ["ACME-2", 20],
    ["ACME-3", 30],
    ["ACME-4", 40],
    ["ACME-5", 50],
  ] as const) {
    tracker.addTicket(ticket(key, web, updated));
  }
  tracker.addTicket(
    ticket("ACME-6", web, 60, [
      { id: autoLabel, name: "factory" },
      { id: toLabelId("label-bug"), name: "bug" },
    ]),
  );
  tracker.addTicket(ticket("DOC-1", { id: docsProject, name: "Docs" }, 5));
  tracker.addTicket(ticket("LAB-1", { id: labProject, name: "Lab" }, 5));

  const ids = new Map<string, RunId>();
  let clock = 0;
  const assign = (key: string): RunId => {
    clock += 1;
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey(key) },
      trackerProject: webProject,
      runnerProject: webRepo,
      agent: toAgentId("claude"),
      now: minutes(clock),
    });
    if (!result.ok) throw new Error(`assign ${key}: ${result.reason}`);
    ids.set(key, result.run.id);
    return result.run.id;
  };
  const start = (id: RunId) => {
    clock += 1;
    expectOk(
      changeRunState(
        db,
        id,
        {
          to: "running",
          started: {
            worktree: toWorktreeRef(`wt-${id}`),
            branch: `acme/${id}`,
            agentRef: toAgentRef(`agent-${id}`),
          },
        },
        minutes(clock),
      ),
    );
  };
  const end = (id: RunId, agentResult: AgentResult, prState: PrState) => {
    clock += 1;
    expectOk(changeRunState(db, id, { to: "ended", agentResult, prState }, minutes(clock)));
  };

  const first = assign("ACME-1");
  start(first);
  end(first, "timed-out", "none");
  ids.set("ACME-1:first", first);
  const second = assign("ACME-1");
  start(second);
  end(second, "reported-success", "merged");
  const human = assign("ACME-2");
  start(human);
  end(human, "reported-failure", "open");
  start(assign("ACME-3"));
  assign("ACME-4");
  const waiting = assign("ACME-5");
  start(waiting);
  expectOk(changeRunState(db, waiting, { to: "waiting-for-input" }, minutes(clock + 1)));

  const registry = new AdapterRegistry().registerTracker({
    kind: fakeKind,
    create: () => tracker,
  });
  return { db, tracker, context: { db, secretBox, registry }, ids };
}

function addRunner(
  db: Database,
  name: string,
  input: { online: boolean; blocked: boolean; projects: RunnerProjectId[] },
): void {
  const id = toRunnerId(name);
  saveRunner(db, { id, kind: toRunnerKind("fake"), name, config: {}, capacity: 2 }, minutes(0));
  recordRunnerCheck(db, {
    runnerId: id,
    online: input.online,
    checkedAt: minutes(0),
    error: null,
    assignmentBlocked: input.blocked,
    projects: input.projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })),
  });
}

function expectOk(result: { ok: boolean }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result)}`);
}
