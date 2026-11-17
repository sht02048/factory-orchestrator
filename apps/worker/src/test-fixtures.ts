import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdapterError,
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
} from "@factory/core";
import type {
  PullRequestSnapshot,
  RetryToken,
  Runner,
  RunnerErrorDetail,
  RunnerId,
  RunnerProjectId,
} from "@factory/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  assignRun,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveCodeHostConnection,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { createWorker } from "./worker.js";
import type { Worker, WorkerLogger } from "./worker.js";

export const connection = toTrackerConnectionId("conn-1");
export const trackerProject = toTrackerProjectId("tp-1");
export const agent = toAgentId("claude");
export const projectA = toRunnerProjectId("fake:acme/a");
export const projectB = toRunnerProjectId("fake:acme/b");
export const projectC = toRunnerProjectId("fake:acme/c");

const fakeKind = "fake";
const workspaceId = toWorkspaceId("ws-1");

/** 러너 쪽 프로젝트 ID "fake:<저장소>"에서 FakeCodeHost가 읽는 저장소 */
export function repoOf(project: RunnerProjectId) {
  return toRepoRef(project.slice("fake:".length));
}

/**
 * 시험 하나의 환경. 임시 디렉터리의 DB 파일, 가짜 트래커·코드 호스트 하나, 러너 ID별 가짜 러너.
 * 가짜 어댑터는 worker 밖에서 응답을 정하려고 registry factory가 같은 인스턴스를 돌려준다.
 * 데몬을 다시 띄워도(새 worker) 러너·트래커·코드 호스트 쪽 상태는 이어진다.
 */
export class Harness {
  readonly dbPath: string;
  readonly db: Database;
  readonly secretBox = new SecretBox(new Uint8Array(32).fill(7));
  readonly tracker = new FakeTracker(toTrackerKind(fakeKind));
  readonly codeHost = new FakeCodeHost(toCodeHostKind(fakeKind));
  readonly runners = new Map<RunnerId, FakeRunner>();
  readonly registry: AdapterRegistry;
  readonly warnings: Array<{ message: string; fields: unknown }> = [];
  now = new Date("2026-11-17T00:00:00Z");
  private readonly dir: string;
  private readonly workers: Worker[] = [];
  private prSeq = 0;
  /** startRun을 감쌀 때 쓴다(데몬이 죽는 때를 흉내 낸다). */
  wrapRunner: (runner: FakeRunner) => Runner = (runner) => runner;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "factory-worker-"));
    this.dbPath = join(this.dir, "factory.db");
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

    this.registry = new AdapterRegistry()
      .registerTracker({ kind: toTrackerKind(fakeKind), create: () => this.tracker })
      .registerCodeHost({ kind: toCodeHostKind(fakeKind), create: () => this.codeHost })
      .registerRunner({
        kind: toRunnerKind(fakeKind),
        create: (config) => this.wrapRunner(this.runnerFromConfig(config)),
      });
  }

  /** 러너 상태 확인(0016) 전까지 러너의 Online 상태와 프로젝트 목록은 시험이 DB에 직접 넣는다. */
  addRunner(input: {
    id: string;
    capacity: number;
    online?: boolean;
    projects: RunnerProjectId[];
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
    this.setRunnerOnline(id, input.online ?? true, input.projects);
    return id;
  }

  setRunnerOnline(id: RunnerId, online: boolean, projects: RunnerProjectId[] | null = null): void {
    const fake = this.runner(id);
    fake.online = online;
    recordRunnerCheck(this.db, {
      runnerId: id,
      online,
      checkedAt: this.now,
      error: null,
      projects:
        projects === null
          ? null
          : projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })),
    });
  }

  runner(id: RunnerId): FakeRunner {
    const fake = this.runners.get(id);
    if (fake === undefined) throw new Error(`no fake runner ${id}`);
    return fake;
  }

  /** 트래커에 티켓을 넣고 db 할당 진입점으로 런을 만든다. 할당 시각은 1초씩 늘려 순서를 정한다. */
  assign(key: string, project: RunnerProjectId): StoredRun {
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
      now: this.now,
    });
    if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
    return result.run;
  }

  /** 런의 브랜치로 PR을 넣는다. */
  putPullRequest(run: StoredRun, state: PullRequestSnapshot["state"]): void {
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
    const logger: WorkerLogger = {
      warn: (message, fields) => this.warnings.push({ message, fields }),
    };
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

/** startRun에 보낸 다시 보내기 값을 모은다. */
export function recordingStarts(runner: Runner, sent: Array<RetryToken | undefined>): Runner {
  return delegate(runner, (input) => {
    sent.push(input.retryToken);
    return runner.startRun(input);
  });
}

/** 러너가 시작은 했지만 응답을 잃어 결과를 모른다고 답한 경우(start-outcome-unknown). */
export function outcomeUnknownAfterStart(
  runner: Runner,
  sent: Array<RetryToken | undefined>,
): Runner {
  return delegate(runner, async (input) => {
    sent.push(input.retryToken);
    const started = await runner.startRun(input);
    if (started.retryToken === null) throw new Error("fake runner gave no retry token");
    throw new AdapterError<RunnerErrorDetail>({
      kind: "start-outcome-unknown",
      retryToken: started.retryToken,
    });
  });
}

function delegate(runner: Runner, startRun: Runner["startRun"]): Runner {
  return {
    kind: runner.kind,
    checkHealth: () => runner.checkHealth(),
    listProjects: () => runner.listProjects(),
    startRun,
    pollRun: (worktree) => runner.pollRun(worktree),
    stopAgent: (worktree) => runner.stopAgent(worktree),
    readLogTail: (worktree, opts) => runner.readLogTail(worktree, opts),
    worktreeExists: (worktree) => runner.worktreeExists(worktree),
    removeWorktree: (worktree, opts) => runner.removeWorktree(worktree, opts),
  };
}
