import {
  AdapterError,
  decidePrState,
  planQueue,
  resolveRunProgress,
  toRetryToken,
} from "@factory/core";
import type {
  AdapterRegistry,
  PrStateDecision,
  QueuedRun,
  RetryToken,
  RunnerChoice,
  RunnerId,
} from "@factory/core";
import {
  changeRunState,
  getRunWithRecords,
  inTransaction,
  listRunPlacements,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  openDatabase,
  setQueuedRunRunner,
  updateRunRecords,
} from "@factory/db";
import type { Database, SecretBox, StoredRun, StoredRunner } from "@factory/db";
import { WorkerAdapters } from "./adapters.js";

/** worker가 남기는 기록. 런 하나의 실패는 루프를 멈추지 않고 여기로 보낸다. */
export interface WorkerLogger {
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface WorkerOptions {
  /** web과 함께 쓰는 SQLite 파일(ADR 0002). 마이그레이션은 부르는 쪽이 먼저 돌린다. */
  dbPath: string;
  /** 어댑터 factory를 등록한 registry. 저장한 종류로 어댑터를 만든다. */
  registry: AdapterRegistry;
  /** 트래커·코드 호스트 연결의 비밀값을 연다. */
  secretBox: SecretBox;
  now?: () => Date;
  logger?: WorkerLogger;
}

export interface Worker {
  /** 폴링 한 바퀴: Running 런을 보고 끝난 런의 두 축을 기록한 뒤, 대기열에서 런을 시작한다. */
  tick(): Promise<void>;
  /** DB를 닫는다. 돌던 tick이 끝나기를 기다린다. */
  close(): Promise<void>;
}

export interface RunningWorker {
  /** 루프를 멈추고 DB를 닫는다. 돌던 tick이 끝나기를 기다린다. */
  stop(): Promise<void>;
}

const consoleLogger: WorkerLogger = {
  warn: (message, fields) => console.warn(`[worker] ${message}`, fields ?? {}),
};

/**
 * worker 루프를 띄운다. 앞 tick이 끝난 뒤 `pollIntervalMs`만큼 쉬고 다음 tick을 돈다.
 * 상태는 DB에만 두므로 언제 멈췄다 다시 띄워도 이어서 폴링한다(ADR 0002·0005).
 */
export function startWorker(options: WorkerOptions & { pollIntervalMs: number }): RunningWorker {
  const worker = createWorker(options);
  const logger = options.logger ?? consoleLogger;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const loop = async (): Promise<void> => {
    timer = null;
    try {
      await worker.tick();
    } catch (error) {
      logger.warn("tick failed", { error });
    }
    if (!stopped) timer = setTimeout(() => void loop(), options.pollIntervalMs);
  };
  void loop();

  return {
    stop: async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await worker.close();
    },
  };
}

/** 루프 없이 tick을 직접 부르는 worker. 시험과 startWorker가 쓴다. */
export function createWorker(options: WorkerOptions): Worker {
  const db = openDatabase(options.dbPath);
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? consoleLogger;
  const adapters = new WorkerAdapters(options.registry, options.secretBox);
  const context: TickContext = { db, now, logger, adapters };
  let running: Promise<void> | null = null;
  let closed = false;

  return {
    tick: () => {
      if (closed) return Promise.reject(new Error("worker is closed"));
      // tick은 겹치지 않는다. 겹치면 같은 Queued 런을 두 번 시작하려 할 수 있다.
      running ??= tick(context).finally(() => {
        running = null;
      });
      return running;
    },
    close: async () => {
      closed = true;
      if (running !== null) await running.catch(() => undefined);
      db.$client.close();
    },
  };
}

interface TickContext {
  db: Database;
  now: () => Date;
  logger: WorkerLogger;
  adapters: WorkerAdapters;
}

async function tick(context: TickContext): Promise<void> {
  // 끝난 런이 내놓은 capacity를 같은 바퀴의 대기열이 쓰도록 먼저 본다.
  await pollActiveRuns(context);
  await processQueue(context);
}

// ---------- Running 런 ----------

/**
 * Running·Waiting for Input 런의 실제 상태를 읽는다. 에이전트가 끝났으면 PR 상태를 정하고
 * 두 축을 한 번 기록한다(ADR 0004, Q66). 입력 기다림·시간 초과·연결 끊김 처리는 0016이 더한다.
 */
async function pollActiveRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  const runnersById = new Map(listRunners(db).map((runner) => [runner.id, runner]));
  for (const run of listRuns(db, { states: ["running", "waiting-for-input"] })) {
    if (run.state !== "running" && run.state !== "waiting-for-input") continue;
    try {
      await pollRun(context, run, runnersById.get(run.runnerId));
    } catch (error) {
      // 이번 바퀴에 읽지 못했으면 다음 바퀴에 다시 본다.
      logger.warn("could not poll run", { runId: run.id, error });
    }
  }
}

/** 러너와 워크트리가 있고 아직 끝나지 않은 런 */
type ActiveRun = Exclude<StoredRun, { state: "queued" | "ended" }>;

async function pollRun(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner | undefined,
): Promise<void> {
  const { db, now, logger, adapters } = context;
  if (storedRunner === undefined) {
    logger.warn("run's runner is not registered", { runId: run.id, runnerId: run.runnerId });
    return;
  }

  const progress = await adapters.runner(storedRunner).pollRun(run.worktree);
  const resolution = resolveRunProgress(progress);
  if (resolution.kind === "continue") {
    if (resolution.state !== run.state) {
      reportFailure(logger, run, changeRunState(db, run.id, { to: resolution.state }, now()));
    }
    return;
  }

  // PR을 찾지 못하면(코드 호스트 오류) 끝내지 않고 다음 바퀴에 다시 본다. 두 축은 한 번만 기록한다.
  const decision = await decideRunPrState(context, run);
  inTransaction(db, () => {
    const result = changeRunState(
      db,
      run.id,
      { to: "ended", agentResult: resolution.agentResult, prState: decision.prState },
      now(),
    );
    if (!result.ok) {
      reportFailure(logger, run, result);
      return;
    }
    if (decision.pr !== null) {
      const { id, displayId, url, ci } = decision.pr;
      updateRunRecords(db, run.id, {
        pullRequest: { id, displayId, url, ci, checkedAt: now() },
      });
    }
  });
}

/**
 * 런과 이어진 PR을 코드 호스트에서 찾아 core decidePrState로 PR 상태를 정한다(Q40).
 * 런의 러너 쪽 프로젝트를 저장소로 읽는 코드 호스트가 없으면 이을 PR이 없으니 없음이다.
 */
async function decideRunPrState(context: TickContext, run: ActiveRun): Promise<PrStateDecision> {
  for (const codeHost of context.adapters.allCodeHosts(context.db)) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    const [byBranch, byTicketKey] = await Promise.all([
      codeHost.findPullRequestsByBranch(repo, run.branch),
      codeHost.findPullRequestsByTicketKey(repo, run.ticket.key),
    ]);
    return decidePrState({ repo, runStartedAt: run.startedAt, byBranch, byTicketKey });
  }
  context.logger.warn("no code host reads the run's project; recording no pull request", {
    runId: run.id,
    runnerProject: run.runnerProject,
  });
  return { prState: "none", pr: null };
}

// ---------- 대기열 ----------

/**
 * 엄격한 FIFO 대기열(ADR 0006). 이번에 할 일은 core planQueue가 정하고 worker는 그대로 옮긴다.
 * 러너를 비우고 정하는 것(Q65·Q68·Q72·Q73)은 한 쓰기 트랜잭션에서 쓰고, 시작은 들어온 순서로 한다.
 * 앞 런이 시작하지 못하면 뒤 런도 이번 바퀴에는 시작하지 않는다(Q63 개정).
 */
async function processQueue(context: TickContext): Promise<void> {
  const { db } = context;
  const plan = inTransaction(db, () => {
    const queued = listRuns(db, { states: ["queued"] });
    if (queued.length === 0) return null;
    const result = planQueue({
      queued: queued.flatMap(toQueuedRun),
      runners: listRunnerSnapshots(db),
      runs: listRunPlacements(db),
    });
    for (const runId of result.cleared) {
      setQueuedRunRunner(db, runId, null);
      // 시작 다시 보내기 값은 그 러너에만 뜻이 있다.
      updateRunRecords(db, runId, { retryToken: null });
    }
    for (const choice of result.assigned) setQueuedRunRunner(db, choice.runId, choice.runnerId);
    return result;
  });

  for (const choice of plan?.start ?? []) {
    if (!(await startQueuedRun(context, choice))) return;
  }
}

function toQueuedRun(run: StoredRun): QueuedRun[] {
  if (run.state !== "queued") return [];
  return [
    { id: run.id, assignedAt: run.assignedAt, project: run.runnerProject, runnerId: run.runnerId },
  ];
}

/**
 * Queued 런 하나를 러너에서 시작하고 Running으로 바꾼다. 시작했으면 true다.
 *
 * 재시작 안전(ADR 0002·0005): 러너에 시작을 보내기 전에 다시 보내기 값(retryToken)을 DB에 먼저 쓴다.
 * 시작을 보낸 뒤 Running을 쓰기 전에 데몬이 죽으면, 다음 바퀴에 런은 아직 Queued이고 같은 값으로
 * 다시 보내 러너가 같은 시작을 돌려준다. 러너가 결과를 모른다고 답하면(start-outcome-unknown)
 * 러너가 준 값으로 바꿔 두고 다음 바퀴에 다시 보낸다.
 */
async function startQueuedRun(context: TickContext, choice: RunnerChoice): Promise<boolean> {
  const { db, now, logger, adapters } = context;
  const found = getRunWithRecords(db, choice.runId);
  if (found === null) return false;
  const { run, records } = found;
  if (run.state !== "queued" || run.runnerId !== choice.runnerId) return false;

  const storedRunner = findRunner(db, choice.runnerId);
  if (storedRunner === undefined) return false;
  const tracker = adapters.tracker(db, run.ticket.connection);
  if (tracker === null) {
    logger.warn("run's tracker connection is not registered", { runId: run.id });
    return false;
  }

  try {
    const ticket = await tracker.getTicket(run.ticket.key);
    if (ticket === null) {
      logger.warn("run's ticket was not found in the tracker", { runId: run.id });
      return false;
    }

    const retryToken = records.retryToken ?? toRetryToken(`run-${run.id}`);
    if (records.retryToken === null) updateRunRecords(db, run.id, { retryToken });

    const started = await adapters.runner(storedRunner).startRun({
      project: run.runnerProject,
      worktreeName: run.branch.replaceAll("/", "-"),
      branch: run.branch,
      agent: run.agent,
      // 에이전트에게는 티켓만 지시로 준다(GLOSSARY Agent).
      prompt: `${ticket.title}\n\n${ticket.body}`,
      ticket: { key: ticket.key, url: ticket.url },
      retryToken,
    });

    return inTransaction(db, () => {
      const result = changeRunState(
        db,
        run.id,
        { to: "running", worktree: started.worktree },
        now(),
      );
      if (!result.ok) {
        reportFailure(logger, run, result);
        return false;
      }
      if (started.retryToken !== null) {
        updateRunRecords(db, run.id, { retryToken: started.retryToken });
      }
      return true;
    });
  } catch (error) {
    const retryToken = startOutcomeUnknownToken(error);
    if (retryToken !== null) updateRunRecords(db, run.id, { retryToken });
    logger.warn("could not start run", { runId: run.id, error });
    return false;
  }
}

function findRunner(db: Database, id: RunnerId): StoredRunner | undefined {
  return listRunners(db).find((runner) => runner.id === id);
}

/** 러너가 시작 결과를 모른다고 답했으면 다시 보낼 값을 꺼낸다. */
function startOutcomeUnknownToken(error: unknown): RetryToken | null {
  if (!(error instanceof AdapterError)) return null;
  const detail: unknown = error.detail;
  if (
    typeof detail === "object" &&
    detail !== null &&
    "kind" in detail &&
    detail.kind === "start-outcome-unknown" &&
    "retryToken" in detail &&
    typeof detail.retryToken === "string" &&
    detail.retryToken.length > 0
  ) {
    return toRetryToken(detail.retryToken);
  }
  return null;
}

function reportFailure(
  logger: WorkerLogger,
  run: StoredRun,
  result: ReturnType<typeof changeRunState>,
): void {
  if (!result.ok) logger.warn("could not change run state", { runId: run.id, error: result.error });
}
