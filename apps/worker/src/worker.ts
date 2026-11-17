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
  RunId,
  RunnerId,
  StartedRun,
} from "@factory/core";
import {
  changeRunState,
  getRun,
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
  const context: TickContext = { db, now, logger, adapters, pendingStarts: new Map() };
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
      if (closed) return;
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
  /** 러너에 보냈지만 Running이 되지 않은 시작. 러너 하나에 묶인다. */
  pendingStarts: Map<RunId, PendingStart>;
}

/**
 * 러너에 보낸 시작 중 아직 Running을 쓰지 못한 것.
 * - started: 러너가 시작했다고 답했지만 DB 쓰기가 실패했다. 다음 바퀴에 기록만 다시 한다.
 * - retryToken: 러너가 결과를 모른다고 답하며 준 다시 보내기 값. DB에 쓰지 못했어도 이 값으로 다시 보낸다.
 */
interface PendingStart {
  runnerId: RunnerId;
  started: StartedRun | null;
  retryToken: RetryToken | null;
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
  const endedAt = now();
  inTransaction(db, () => {
    const result = changeRunState(
      db,
      run.id,
      { to: "ended", agentResult: resolution.agentResult, prState: decision.prState },
      endedAt,
    );
    if (!result.ok) {
      reportFailure(logger, run, result);
      return;
    }
    if (decision.pr !== null) {
      const { id, displayId, url, ci } = decision.pr;
      updateRunRecords(db, run.id, {
        pullRequest: { id, displayId, url, ci, checkedAt: endedAt },
      });
    }
  });
}

/**
 * 런과 이어진 PR을 코드 호스트에서 찾아 core decidePrState로 PR 상태를 정한다(Q40).
 * 런의 러너 쪽 프로젝트를 저장소로 읽는 코드 호스트가 없으면 이을 PR이 없으니 없음이다.
 * 다만 어댑터를 만들지 못한 코드 호스트 연결이 있으면 그 연결이 이 저장소를 읽을 수 있으니,
 * 없음으로 확정하지 않고 던져 다음 바퀴에 다시 본다(두 축은 한 번만 기록한다, Q69).
 */
async function decideRunPrState(context: TickContext, run: ActiveRun): Promise<PrStateDecision> {
  let unavailable = 0;
  const codeHosts = context.adapters.allCodeHosts(context.db, (connectionId, error) => {
    unavailable += 1;
    context.logger.warn("could not create code host adapter", { connectionId, error });
  });
  for (const codeHost of codeHosts) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    const [byBranch, byTicketKey] = await Promise.all([
      codeHost.findPullRequestsByBranch(repo, run.branch),
      codeHost.findPullRequestsByTicketKey(repo, run.ticket.key),
    ]);
    return decidePrState({ repo, runStartedAt: run.startedAt, byBranch, byTicketKey });
  }
  if (unavailable > 0) {
    throw new Error(
      "no code host reads the run's project while some code host adapters are unavailable",
    );
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
 *
 * 예외: 러너에 보낸 시작의 결과를 아직 모르는 런(boundRunners)은 그 러너에 묶어 둔다. 첫 시작이 실제로
 * 됐다면 다른 러너에서 다시 시작할 때 에이전트가 둘 생기기 때문이다.
 * - 묶인 러너가 Online이면 그대로 planQueue에 넣는다. 러너가 정해져 있어 그 러너에서만 시작한다.
 * - 묶인 러너가 Online이 아니면 planQueue에 넣지 않는다. 러너를 비우거나 다른 러너를 고르지 않고,
 *   Offline 예외(Q68)처럼 순서에서 빠져 뒤 런을 막지 않는다. 러너가 돌아오면 원래 자리로 돌아간다.
 * - 러너에서 시작했지만 Running을 쓰지 못한 런은 판단 전에 기록을 다시 해 본다. 그래도 못 쓰면
 *   planQueue에 넣지 않고 그 러너의 capacity를 차지한 것으로 센다.
 */
async function processQueue(context: TickContext): Promise<void> {
  const { db, pendingStarts } = context;
  recordPendingStarts(context);

  const plan = inTransaction(db, () => {
    const queued = listRuns(db, { states: ["queued"] });
    if (queued.length === 0) return null;
    const runners = listRunnerSnapshots(db);
    const online = new Set(runners.filter((runner) => runner.online).map((runner) => runner.id));
    const bound = boundRunners(context, queued);
    const runs = listRunPlacements(db);
    for (const pending of pendingStarts.values()) {
      if (pending.started !== null) runs.push({ runnerId: pending.runnerId, state: "running" });
    }
    const candidates = queued.flatMap(toQueuedRun).filter((run) => {
      const runnerId = bound.get(run.id);
      if (runnerId === undefined) return true;
      return (pendingStarts.get(run.id)?.started ?? null) === null && online.has(runnerId);
    });

    const result = planQueue({ queued: candidates, runners, runs });
    for (const runId of result.cleared) setQueuedRunRunner(db, runId, null);
    for (const choice of result.assigned) setQueuedRunRunner(db, choice.runId, choice.runnerId);
    return result.start;
  });

  for (const choice of plan ?? []) {
    if (!(await startQueuedRun(context, choice))) return;
  }
}

/** 러너에서 시작했지만 Running을 쓰지 못한 런을 다시 기록한다. */
function recordPendingStarts(context: TickContext): void {
  for (const [runId, pending] of context.pendingStarts) {
    const { started } = pending;
    if (started === null) continue;
    const run = getRun(context.db, runId);
    if (run?.state !== "queued") {
      context.pendingStarts.delete(runId);
      continue;
    }
    if (tryWrite(context, run, () => recordStart(context, run, started)) !== undefined) {
      context.pendingStarts.delete(runId);
    }
  }
}

/** 러너에 보낸 시작의 결과를 아직 모르는 Queued 런과 그 러너 */
function boundRunners(
  context: TickContext,
  queued: ReadonlyArray<StoredRun>,
): Map<RunId, RunnerId> {
  const bound = new Map<RunId, RunnerId>();
  for (const run of queued) {
    const pending = context.pendingStarts.get(run.id);
    if (pending !== undefined) {
      bound.set(run.id, pending.runnerId);
      continue;
    }
    if (run.state !== "queued" || run.runnerId === null) continue;
    if ((getRunWithRecords(context.db, run.id)?.records.retryToken ?? null) !== null) {
      bound.set(run.id, run.runnerId);
    }
  }
  return bound;
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
 * 재시작 안전(ADR 0002·0005): 상태는 DB에만 있다. Running을 쓴 뒤에 데몬이 죽으면 다시 떠도 그 런은
 * 대기열에 없어 다시 시작하지 않는다. 러너가 시작 결과를 모른다고 답하면(start-outcome-unknown)
 * 러너가 준 다시 보내기 값(retryToken)을 DB에 써 두고, 다음 바퀴에(데몬을 다시 띄운 뒤라도) 그 값으로
 * 같은 시작을 다시 보낸다. 다시 보내기 값은 러너가 발급한 것만 보낸다(core StartRunInput).
 * 데몬이 살아 있는 동안 DB 쓰기만 실패하면 시작 결과나 다시 보내기 값을 메모리(pendingStarts)에 두고
 * 다음 바퀴에 쓴다.
 *
 * 알려진 한계: 러너의 응답을 받은 뒤 DB에 쓰기 전에 데몬이 죽으면 다시 띄웠을 때 시작을 새로 보낸다.
 * 지금 Runner 계약에서는 시작 전에 둘 멱등 키가 없다. 0037에서 결정적 워크트리 이름·브랜치(Q40)를 멱등 키로
 * 쓰고, 재시작 때 러너 어댑터가 그 이름으로 이미 시작한 런을 찾아 이어 붙이는 계약을 core에 더한다.
 */
async function startQueuedRun(context: TickContext, choice: RunnerChoice): Promise<boolean> {
  const { db, pendingStarts } = context;
  const found = getRunWithRecords(db, choice.runId);
  if (found === null) {
    pendingStarts.delete(choice.runId);
    return false;
  }
  const { run, records } = found;
  if (run.state !== "queued") {
    pendingStarts.delete(choice.runId);
    return false;
  }
  const pending = pendingStarts.get(run.id);
  if (
    run.runnerId !== choice.runnerId ||
    (pending !== undefined && pending.runnerId !== choice.runnerId)
  ) {
    return false;
  }

  const started =
    pending?.started ??
    (await startOnRunner(context, run, choice.runnerId, pending?.retryToken ?? records.retryToken));
  if (started === null) return false;
  pendingStarts.set(run.id, { runnerId: choice.runnerId, started, retryToken: started.retryToken });

  const recorded = tryWrite(context, run, () => recordStart(context, run, started));
  if (recorded !== undefined) pendingStarts.delete(run.id);
  return recorded === true;
}

/**
 * 러너에 시작을 보낸다. 시작하지 못했으면 null이다. 러너가 결과를 모른다고 답하면 러너가 준
 * 다시 보내기 값을 DB에 써 둔다.
 */
async function startOnRunner(
  context: TickContext,
  run: Extract<StoredRun, { state: "queued" }>,
  runnerId: RunnerId,
  retryToken: RetryToken | null,
): Promise<StartedRun | null> {
  try {
    return await sendStart(context, run, runnerId, retryToken);
  } catch (error) {
    context.logger.warn("could not start run", { runId: run.id, error });
    const issued = startOutcomeUnknownToken(error);
    if (issued !== null) {
      // DB에 쓰지 못해도 다시 보낼 수 있게 먼저 메모리에 둔다.
      context.pendingStarts.set(run.id, { runnerId, started: null, retryToken: issued });
      tryWrite(context, run, () => updateRunRecords(context.db, run.id, { retryToken: issued }));
    }
    return null;
  }
}

/** 러너에 시작을 보낸다. 티켓·러너를 찾지 못하면 null이다. */
async function sendStart(
  context: TickContext,
  run: Extract<StoredRun, { state: "queued" }>,
  runnerId: RunnerId,
  retryToken: RetryToken | null,
): Promise<StartedRun | null> {
  const { db, logger, adapters } = context;
  const storedRunner = findRunner(db, runnerId);
  if (storedRunner === undefined) {
    logger.warn("run's runner is not registered", { runId: run.id, runnerId });
    return null;
  }
  const tracker = adapters.tracker(db, run.ticket.connection);
  if (tracker === null) {
    logger.warn("run's tracker connection is not registered", { runId: run.id });
    return null;
  }
  const ticket = await tracker.getTicket(run.ticket.key);
  if (ticket === null) {
    logger.warn("run's ticket was not found in the tracker", { runId: run.id });
    return null;
  }

  const started = await adapters.runner(storedRunner).startRun({
    project: run.runnerProject,
    worktreeName: run.branch.replaceAll("/", "-"),
    branch: run.branch,
    agent: run.agent,
    // 에이전트에게는 티켓만 지시로 준다(GLOSSARY Agent).
    prompt: `${ticket.title}\n\n${ticket.body}`,
    ticket: { key: ticket.key, url: ticket.url },
    ...(retryToken === null ? {} : { retryToken }),
  });
  if (started.branch !== run.branch) {
    // PR 1순위 찾기는 런의 브랜치로 한다(Q40). 러너가 다른 브랜치를 쓰면 티켓 키로만 잇는다.
    logger.warn("runner started the run on another branch", {
      runId: run.id,
      expected: run.branch,
      actual: started.branch,
    });
  }
  return started;
}

/** 시작한 런을 Running으로 쓴다. 런이 더는 Queued가 아니면 false다. */
function recordStart(context: TickContext, run: StoredRun, started: StartedRun): boolean {
  const { db, now, logger } = context;
  return inTransaction(db, () => {
    const result = changeRunState(db, run.id, { to: "running", worktree: started.worktree }, now());
    if (!result.ok) {
      reportFailure(logger, run, result);
      return false;
    }
    if (started.retryToken !== null) {
      updateRunRecords(db, run.id, { retryToken: started.retryToken });
    }
    return true;
  });
}

/** DB 쓰기. 실패하면(쓰기 잠금 시간 초과 등) 알리고 undefined를 돌려준다. */
function tryWrite<T>(context: TickContext, run: StoredRun, write: () => T): T | undefined {
  try {
    return write();
  } catch (error) {
    context.logger.warn("could not write run", { runId: run.id, error });
    return undefined;
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
