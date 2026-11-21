import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toPullRequestId,
  toRepoRef,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { PullRequestSnapshot, Runner, RunnerId, RunnerProjectId } from "@ganger/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { createWorker } from "./worker.js";
import type { Worker, WorkerLogger } from "./worker.js";
import { memoryLogger } from "@ganger/log/testing";

export const connection = toTrackerConnectionId("conn-1");
export const trackerProject = toTrackerProjectId("tp-1");
export const agent = toAgentId("claude");
export const projectA = toRunnerProjectId("fake:acme/a");
export const projectB = toRunnerProjectId("fake:acme/b");
export const projectC = toRunnerProjectId("fake:acme/c");

const fakeKind = "fake";
export const workspaceId = toWorkspaceId("ws-1");

export function repoOf(project: RunnerProjectId) {
  return toRepoRef(project.slice("fake:".length));
}

export class Harness {
  readonly dbPath: string;
  readonly db: Database;
  readonly secretBox = new SecretBox(new Uint8Array(32).fill(7));
  readonly tracker = new FakeTracker(toTrackerKind(fakeKind));
  readonly codeHost = new FakeCodeHost(toCodeHostKind(fakeKind));
  readonly runners = new Map<RunnerId, FakeRunner>();
  readonly registry: AdapterRegistry;
  readonly log = memoryLogger();

  get warnings(): Array<{ message: string; event: string; fields: unknown }> {
    return this.log.entries
      .filter((entry) => entry.level === "warn")
      .map((entry) => ({ message: entry.msg, event: entry.event, fields: entry.fields }));
  }
  now = new Date("2026-11-17T00:00:00Z");
  codeHostBroken = false;
  private readonly dir: string;
  private readonly workers: Worker[] = [];
  private prSeq = 0;
  wrapRunner: (runner: FakeRunner) => Runner = (runner) => runner;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "ganger-worker-"));
    this.dbPath = join(this.dir, "ganger.db");
    this.db = openDatabase(this.dbPath);
    migrate(this.db);
    saveTrackerConnection(this.db, this.secretBox, {
      id: connection,
      kind: toTrackerKind(fakeKind),
      name: "Acme",
      config: {},
      secrets: { apiKey: "secret" },
    });
    saveCodeHostConnection(this.db, this.secretBox, {
      id: toCodeHostConnectionId("code-1"),
      kind: toCodeHostKind(fakeKind),
      name: "Acme",
      config: {},
      secrets: { token: "secret" },
    });
    saveWorkspace(this.db, { id: workspaceId, name: "Acme" });
    saveWorkspaceTrackerProject(this.db, {
      workspaceId,
      connection,
      projectId: trackerProject,
      name: "Web",
      inProgressStateId: null,
    });
    saveMapping(this.db, { connection, trackerProject, runnerProject: projectA, agent });

    this.registry = new AdapterRegistry()
      .registerTracker({ kind: toTrackerKind(fakeKind), create: () => this.tracker })
      .registerCodeHost({
        kind: toCodeHostKind(fakeKind),
        create: () => {
          if (this.codeHostBroken) throw new Error("code host config is broken");
          return this.codeHost;
        },
      })
      .registerRunner({
        kind: toRunnerKind(fakeKind),
        create: (config) => this.wrapRunner(this.runnerFromConfig(config)),
      });
  }

  addRunner(input: {
    id: string;
    capacity: number;
    online?: boolean;
    projects: RunnerProjectId[];
    assignmentBlocked?: boolean;
  }): RunnerId {
    const id = toRunnerId(input.id);
    const fake = new FakeRunner(toRunnerKind(fakeKind));
    fake.setProjects(input.projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })));
    this.runners.set(id, fake);
    saveRunner(this.db, {
      id,
      kind: toRunnerKind(fakeKind),
      name: input.id,
      config: { id: input.id },
      capacity: input.capacity,
    });
    this.setRunnerOnline(
      id,
      input.online ?? true,
      input.projects,
      input.assignmentBlocked ?? false,
    );
    return id;
  }

  setRunnerOnline(
    id: RunnerId,
    online: boolean,
    projects: RunnerProjectId[] | null = null,
    assignmentBlocked: boolean | null = null,
  ): void {
    const fake = this.runner(id);
    fake.online = online;
    if (projects !== null) {
      fake.setProjects(projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })));
    }
    if (assignmentBlocked !== null) this.setPushAuth(id, !assignmentBlocked);
    recordRunnerCheck(this.db, {
      runnerId: id,
      online,
      checkedAt: this.now,
      error: null,
      projects:
        projects === null
          ? null
          : projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })),
      assignmentBlocked,
    });
  }

  setPushAuth(id: RunnerId, ok: boolean): void {
    const fake = this.runner(id);
    fake.prerequisites = fake.prerequisites.map((p) =>
      p.blocksAssignment ? { ...p, satisfied: ok } : p,
    );
  }

  runner(id: RunnerId): FakeRunner {
    const fake = this.runners.get(id);
    if (fake === undefined) throw new Error(`no fake runner ${id}`);
    return fake;
  }

  assign(key: string, project: RunnerProjectId, runnerId?: RunnerId): StoredRun {
    const ticketKey = toTicketKey(key);
    this.tracker.addTicket({
      key: ticketKey,
      title: `Ticket ${key}`,
      body: "Do the thing.",
      url: `https://tracker.example.com/${key}`,
      labels: [],
      project: { id: trackerProject, name: "Web" },
      state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
      updatedAt: this.now,
    });
    this.advance(1000);
    const result = assignRun(this.db, {
      ticket: { connection, key: ticketKey },
      trackerProject,
      runnerProject: project,
      agent,
      ...(runnerId === undefined ? {} : { runnerId }),
      now: this.now,
    });
    if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
    return result.run;
  }

  putPullRequest(run: StoredRun, state: PullRequestSnapshot["state"]): void {
    if (run.state === "queued" || run.branch === null) throw new Error("run has not started");
    this.prSeq += 1;
    const repo = repoOf(run.runnerProject);
    this.codeHost.putPullRequest(repo, {
      id: toPullRequestId(`pr-${this.prSeq}`),
      displayId: `#${this.prSeq}`,
      url: `https://code.example.com/acme/pull/${this.prSeq}`,
      title: `${run.ticket.key}: change`,
      body: "",
      state,
      createdAt: this.now,
      mergedAt: state === "merged" ? this.now : null,
      headBranch: run.branch,
      sourceRepo: repo,
      headCommit: "abc123",
      baseBranch: "main",
      ci: "success",
    });
  }

  worker(): Worker {
    const logger: WorkerLogger = this.log;
    const worker = createWorker({
      dbPath: this.dbPath,
      registry: this.registry,
      secretBox: this.secretBox,
      now: () => this.now,
      logger,
    });
    this.workers.push(worker);
    return worker;
  }

  advance(ms: number): void {
    this.now = new Date(this.now.getTime() + ms);
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close().catch(() => undefined)));
    this.db.$client.close();
    rmSync(this.dir, { recursive: true, force: true });
  }

  private runnerFromConfig(config: unknown): FakeRunner {
    if (typeof config !== "object" || config === null || !("id" in config)) {
      throw new TypeError("fake runner config needs an id");
    }
    const { id } = config;
    if (typeof id !== "string") throw new TypeError("fake runner config id must be a string");
    return this.runner(toRunnerId(id));
  }
}
