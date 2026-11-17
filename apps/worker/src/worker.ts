import { canRunnerTake, decideStartFailure, MAX_START_RETRIES, planQueue } from "@factory/core";
import type {
  AdapterRegistry,
  MailboxRef,
  QueuedRun,
  Runner,
  RunnerChoice,
  RunId,
  RunnerId,
  StartedRun,
  TicketKey,
} from "@factory/core";
import {
  changeRunState,
  clearStartRequested,
  getMapping,
  getRun,
  getRunWithRecords,
  hasPendingCancelRequest,
  inTransaction,
  listPendingCancelRequests,
  listRunPlacements,
  listRunnerSnapshots,
  listRuns,
  markCancelRequestProcessed,
  openDatabase,
  recordStartFailure,
  recordStartRequested,
  setQueuedRunRunner,
  setRunnerMailbox,
} from "@factory/db";
import type { SecretBox, StoredRun } from "@factory/db";
import { WorkerAdapters } from "./adapters.js";
import {
  describe,
  findRunner,
  mailboxFor,
  reportFailure,
  runnerErrorDetail,
  tryWrite,
} from "./context.js";
import type { QueuedStoredRun, TickContext, WorkerLogger } from "./context.js";
import { processAfterRuns } from "./after-run.js";
import { assignAutomatically, createAutoAssignState } from "./auto-assign.js";
import { processWebRequests } from "./requests.js";
import { checkRunners } from "./runner-check.js";
import { watchActiveRuns } from "./watch.js";

export type { WorkerLogger } from "./context.js";

export interface WorkerOptions {
  /** web과 함께 쓰는 SQLite 파일(ADR 0002). 마이그레이션은 부르는 쪽이 먼저 돌린다(bootWorker). */
  dbPath: string;
  /** 어댑터 factory를 등록한 registry. 저장한 종류로 어댑터를 만든다. */
  registry: AdapterRegistry;
  /** 트래커·코드 호스트 연결의 비밀값을 연다. */
  secretBox: SecretBox;
  now?: () => Date;
  logger?: WorkerLogger;
}

export interface Worker {
  /**
   * 폴링 한 바퀴: 러너를 확인하고 web 요청을 처리한 뒤, 끝나지 않은 런을 감시해 끝난 런의 두 축을 기록하고,
   * Queued 런의 취소를 처리하고, 자동 할당을 한 뒤 대기열에서 런을 시작하고 런 시작·종료 뒤처리를 한다.
   */
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
  const adapters = new WorkerAdapters(options.registry, options.secretBox, now);
  const context: TickContext = {
    db,
    now,
    logger,
    adapters,
    pendingStarts: new Map(),
    mailboxes: new Map(),
    unreachableUntil: new Map(),
    unmarkedAnswers: new Set(),
    unmarkedDenials: new Set(),
    pendingEndings: new Map(),
    prPolledAt: new Map(),
    unrecordedComments: new Map(),
    ticketsGone: new Set(),
    autoAssign: createAutoAssignState(),
  };
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

async function tick(context: TickContext): Promise<void> {
  context.mailboxes.clear();
  // 대기열 판단이 이번 바퀴의 러너 상태(Online, 프로젝트, GitHub 인증)를 보도록 먼저 확인한다.
  await checkRunners(context);
  // web이 남긴 러너 확인 요청은 대기열 판단 전에 처리한다.
  await processWebRequests(context, "runner-check");
  // 끝난 런이 내놓은 capacity를 같은 바퀴의 대기열이 쓰도록 먼저 본다.
  await watchActiveRuns(context);
  await cancelQueuedRuns(context);
  // 자동으로 할당한 런을 같은 바퀴의 대기열이 시작하도록 대기열 앞에서 한다.
  await assignAutomatically(context);
  await processQueue(context);
  // 이번 바퀴에 시작하거나 끝난 런의 트래커 갱신과 워크트리 정리를 같은 바퀴에 한다.
  await processAfterRuns(context);
  // 로그 꼬리는 닿지 않는 러너에서 오래 걸릴 수 있어 런 감시와 대기열을 늦추지 않게 마지막에 한다.
  await processWebRequests(context, "log-tail");
}

// ---------- Queued 런 취소 ----------

/**
 * 처리하지 않은 취소 요청 중 Queued 런을 끝낸다(Q82.10). 에이전트 결과는 운영자가 취소함이고 PR을 찾지 않아
 * PR 상태는 없음이다. 끝내는 쓰기와 요청 처리 표시는 한 트랜잭션이라 요청은 한 번만 처리한다. 시작한 런의
 * 취소는 감시(watch.ts)가 하고, 이미 Ended인 런의 요청은 처리하지 않는다.
 *
 * 러너에 시작을 보낸 적이 있는 런은 에이전트가 이미 돌고 있을 수 있다. 같은 이름으로 시작한 런을 먼저 찾아
 * 있으면 Running으로 기록해 다음 바퀴에 시작한 런으로 취소하고, 없음을 확인했을 때만 바로 끝낸다.
 */
async function cancelQueuedRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  for (const request of listPendingCancelRequests(db)) {
    const found = getRunWithRecords(db, request.runId);
    if (found?.run.state !== "queued") continue;
    const { run, records } = found;
    // 러너에서 시작했지만 Running을 쓰지 못한 런. 기록한 뒤 시작한 런으로 취소한다.
    if (context.pendingStarts.has(run.id)) continue;
    if (records.startRequestedAt !== null && run.runnerId !== null) {
      const existing = await findStartedForCancel(context, run, run.runnerId);
      if (existing === "unknown") continue;
      if (existing !== null) {
        tryWrite(context, run.id, () => recordStart(context, run.id, existing));
        continue;
      }
    }
    const endedAt = context.now();
    tryWrite(context, run.id, () =>
      inTransaction(db, () => {
        const result = changeRunState(
          db,
          run.id,
          { to: "ended", agentResult: "canceled", prState: "none" },
          endedAt,
        );
        reportFailure(logger, run.id, result);
        if (result.ok) markCancelRequestProcessed(db, run.id, endedAt);
      }),
    );
  }
}

async function findStartedForCancel(
  context: TickContext,
  run: QueuedStoredRun,
  runnerId: RunnerId,
): Promise<StartedRun | null | "unknown"> {
  const storedRunner = findRunner(context.db, runnerId);
  if (storedRunner === undefined) {
    // 러너가 등록에서 빠졌다. 시작했는지 영영 확인할 수 없고 그 러너에 명령할 수도 없으니, 시작하지 않은
    // 런으로 보고 취소를 끝낸다. 기다리면 취소 요청이 끝나지 않는다.
    context.logger.warn("canceling a queued run whose runner is not registered", {
      runId: run.id,
      runnerId,
    });
    return null;
  }
  const runner = context.adapters.runner(storedRunner);
  try {
    const mailbox = await mailboxFor(context, storedRunner, runner);
    return await runner.findStartedRun({ mailbox, worktreeName: run.worktreeName });
  } catch (error) {
    context.logger.warn("could not look up a started run to cancel", { runId: run.id, error });
    return "unknown";
  }
}

// ---------- 대기열 ----------

/**
 * 엄격한 FIFO 대기열(ADR 0006). 이번에 할 일은 core planQueue가 정하고 worker는 그대로 옮긴다.
 * 러너를 비우고 정하는 것(Q65·Q68·Q72·Q73·Q78·Q82.22)과 맨 앞에서 영영 시작할 수 없는 런을 끝내는 것
 * (Q82.16)은 한 쓰기 트랜잭션에서 쓰고, 시작은 들어온 순서로 한다. 앞 런이 시작하지 못하면 뒤 런도
 * 이번 바퀴에는 시작하지 않는다(Q63 개정). 다만 시작 때 러너에 닿지 못한 런과 시작할 수 없음으로
 * 끝낸 런은 순서에서 빠지므로 뒤 런을 이어서 시작한다(Q86).
 *
 * 예외: 러너에 시작을 보낸 적이 있는 런(시작 요청 시각이 있음)은 그 러너에 묶어 둔다. 첫 시작이 실제로
 * 됐다면 다른 러너에서 다시 시작할 때 에이전트가 둘 생기기 때문이다.
 * - 묶인 러너가 그 런을 받을 수 있으면(core canRunnerTake) 그대로 planQueue에 넣는다. 러너가 정해져 있어
 *   그 러너에서만 시작한다.
 * - 받을 수 없으면(Offline, GitHub 인증 깨짐, 프로젝트 빠짐) planQueue에 넣지 않는다. 러너를 비우거나 다른 러너를 고르지 않고,
 *   Offline 예외(Q68)처럼 순서에서 빠져 뒤 런을 막지 않는다. 러너가 돌아오면 원래 자리로 돌아간다.
 * - 러너에서 시작했지만 Running을 쓰지 못한 런은 판단 전에 기록을 다시 해 본다. 그래도 못 쓰면
 *   planQueue에 넣지 않고 그 러너의 capacity를 차지한 것으로 센다.
 */
async function processQueue(context: TickContext): Promise<void> {
  const { db, pendingStarts, now } = context;
  recordPendingStarts(context);

  const plan = inTransaction(db, () => {
    const queued = listRuns(db, { states: ["queued"] });
    if (queued.length === 0) return null;
    const runners = listRunnerSnapshots(db).map((runner) =>
      (context.unreachableUntil.get(runner.id) ?? 0) > now().getTime()
        ? { ...runner, online: false }
        : runner,
    );
    const snapshots = new Map(runners.map((runner) => [runner.id, runner]));
    const bound = boundRunners(context, queued);
    const runs = listRunPlacements(db);
    for (const pending of pendingStarts.values()) {
      runs.push({ runnerId: pending.runnerId, state: "running" });
    }
    const candidates = queued
      .flatMap((run) => toQueuedRun(context, run))
      // 결과를 모르는 시작이 있는 런은 그 러너에서 확인하기 전에 시작할 수 없음으로 끝내지 않는다.
      // 에이전트가 이미 돌고 있을 수 있다.
      .map((run) => (bound.has(run.id) ? { ...run, unstartable: false } : run))
      // 취소를 요청한 런은 시작하지 않는다. 아직 끝내지 못했으면(결과를 모르는 시작 확인 실패 등)
      // 다음 바퀴의 취소 처리를 기다린다.
      .filter((run) => !hasPendingCancelRequest(db, run.id))
      .filter((run) => {
        const runnerId = bound.get(run.id);
        if (runnerId === undefined) return true;
        // 묶인 러너가 그 런을 받을 수 없으면(Offline, 인증 깨짐, 프로젝트 빠짐) planQueue에 넣지 않는다.
        // 넣으면 planQueue가 러너를 비우고 다른 러너를 정해 에이전트가 둘 생길 수 있다.
        const snapshot = snapshots.get(runnerId);
        return (
          !pendingStarts.has(run.id) &&
          snapshot !== undefined &&
          canRunnerTake(snapshot, run.project)
        );
      });

    const result = planQueue({ queued: candidates, runners, runs });
    for (const { runId } of result.cleared) setQueuedRunRunner(db, runId, null);
    for (const choice of result.assigned) setQueuedRunRunner(db, choice.runId, choice.runnerId);
    for (const runId of result.couldNotStart) {
      // 맨 앞 런이 영영 시작할 수 없다(Mapping 삭제 등, Q82.16). PR을 찾지 않아 PR 상태는 없음이다.
      reportFailure(
        context.logger,
        runId,
        changeRunState(
          db,
          runId,
          { to: "ended", agentResult: "could-not-start", prState: "none" },
          now(),
        ),
      );
    }
    return result.start;
  });

  for (const choice of plan ?? []) {
    const outcome = await startQueuedRun(context, choice);
    if (outcome === "blocked") return;
  }
}

/** 러너에서 시작했지만 Running을 쓰지 못한 런을 다시 기록한다. */
function recordPendingStarts(context: TickContext): void {
  for (const [runId, pending] of context.pendingStarts) {
    const run = getRun(context.db, runId);
    if (run?.state !== "queued") {
      context.pendingStarts.delete(runId);
      continue;
    }
    if (
      tryWrite(context, run.id, () => recordStart(context, run.id, pending.started)) !== undefined
    ) {
      context.pendingStarts.delete(runId);
    }
  }
}

/** 러너에 시작을 보낸 적이 있어 그 러너에 묶인 Queued 런과 그 러너 */
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
    if ((getRunWithRecords(context.db, run.id)?.records.startRequestedAt ?? null) !== null) {
      bound.set(run.id, run.runnerId);
    }
  }
  return bound;
}

/** 대기열 판단에 넘기는 모양. 그 런의 Mapping이 지워졌으면 영영 시작할 수 없다(Q82.16). */
function toQueuedRun(context: TickContext, run: StoredRun): QueuedRun[] {
  if (run.state !== "queued") return [];
  const mapping = getMapping(context.db, run.ticket.connection, run.trackerProject);
  return [
    {
      id: run.id,
      assignedAt: run.assignedAt,
      project: run.runnerProject,
      runnerId: run.runnerId,
      unstartable: mapping === null,
    },
  ];
}

/**
 * Queued 런 하나를 러너에서 시작하고 Running으로 바꾼다.
 * - started: 시작했다.
 * - skipped: 순서에서 빠졌다(러너에 닿지 못함, 시작할 수 없음으로 끝냄). 뒤 런은 이어서 본다.
 * - blocked: 시작하지 못했고 이 런이 맨 앞에 남는다. 뒤 런은 이번 바퀴에 시작하지 않는다.
 *
 * 시작 멱등(0037): 결정적 워크트리 이름(Run.worktreeName)이 멱등 키다. 러너에 시작을 처음 보내기 직전에
 * 시작 요청 시각을 DB에 쓰고, 그 시각이 있는 런은 보내기 전에 같은 이름으로 이미 시작한 런을 찾아
 * (Runner.findStartedRun) 있으면 이어 붙인다. 러너의 응답을 받은 뒤 Running을 쓰기 전에 데몬이 죽어도
 * 다시 띄웠을 때 새로 시작하지 않는다. 데몬이 살아 있는 동안 DB 쓰기만 실패하면 시작 결과를
 * 메모리(pendingStarts)에 두고 다음 바퀴에 쓴다.
 *
 * 시작 실패(Q86)는 core decideStartFailure를 따른다.
 */
async function startQueuedRun(
  context: TickContext,
  choice: RunnerChoice,
): Promise<"started" | "skipped" | "blocked"> {
  const { db, pendingStarts } = context;
  const found = getRunWithRecords(db, choice.runId);
  if (found?.run.state !== "queued") {
    pendingStarts.delete(choice.runId);
    return "skipped";
  }
  const { run, records } = found;
  const pending = pendingStarts.get(run.id);
  if (
    run.runnerId !== choice.runnerId ||
    (pending !== undefined && pending.runnerId !== choice.runnerId)
  ) {
    return "blocked";
  }

  let started = pending?.started ?? null;
  if (started === null) {
    const attempt = await startOnRunner(context, run, choice.runnerId, records);
    if (attempt.kind !== "started") return attempt.kind;
    started = attempt.started;
  }
  pendingStarts.set(run.id, { runnerId: choice.runnerId, started });

  const recorded = tryWrite(context, run.id, () => recordStart(context, run.id, started));
  if (recorded !== undefined) pendingStarts.delete(run.id);
  return recorded === true ? "started" : "blocked";
}

type StartAttempt = { kind: "started"; started: StartedRun } | { kind: "skipped" | "blocked" };

/** 러너에 시작을 보낸다. 이미 보낸 적이 있으면 먼저 같은 이름으로 이미 시작한 런을 찾는다. */
async function startOnRunner(
  context: TickContext,
  run: QueuedStoredRun,
  runnerId: RunnerId,
  records: { startRequestedAt: Date | null; startFailures: number },
): Promise<StartAttempt> {
  const { db, logger, adapters } = context;
  const storedRunner = findRunner(db, runnerId);
  if (storedRunner === undefined) {
    logger.warn("run's runner is not registered", { runId: run.id, runnerId });
    return { kind: "blocked" };
  }
  const runner = adapters.runner(storedRunner);
  // 앞서 보낸 시작의 결과를 아직 확인하지 못했는지. 참이면 이 러너에서 확인할 때까지 묶어 둔다.
  let unverified = records.startRequestedAt !== null;
  let mailbox: MailboxRef;
  try {
    mailbox = await mailboxFor(context, storedRunner, runner);
  } catch (error) {
    // 시작 명령 전의 실패라 시도 횟수에 넣지 않는다. 닿지 않으면 Offline처럼 순서에서만 뺀다.
    logger.warn("could not prepare the runner's mailbox", { runId: run.id, error });
    if (!isOfflineLike(error)) return { kind: "blocked" };
    // Offline 예외처럼 순서에서 뺀다. 결과를 모르는 시작이 없으면 러너를 비워 맞는 러너를 다시 고른다.
    markUnreachable(context, runnerId);
    if (!unverified) tryWrite(context, run.id, () => setQueuedRunRunner(db, run.id, null));
    return { kind: "skipped" };
  }
  try {
    if (unverified) {
      const existing = await findStarted(context, run, runner, mailbox);
      // 확인하지 못했으면 러너를 비우지 않고 이번 순서에서만 뺀다. 닿지 않거나 찾기 오류가 이어져도
      // 맨 앞에서 뒤 런을 막지 않는다. 결과를 모르는 동안 다시 보내지는 않는다.
      if (existing === "unreachable") {
        markUnreachable(context, runnerId);
        return { kind: "skipped" };
      }
      if (existing === "unknown") return { kind: "skipped" };
      if (existing !== null) return { kind: "started", started: existing };
      unverified = false;
      // 시작하지 않았음을 확인했다. 읽을 수 없는 출력으로 다시 시도를 다 썼거나(Q86) 그사이 Mapping이
      // 지워져 영영 시작할 수 없게 됐으면(Q82.16) 지금 끝낸다.
      if (
        records.startFailures > MAX_START_RETRIES ||
        getMapping(db, run.ticket.connection, run.trackerProject) === null
      ) {
        return endCouldNotStart(context, run);
      }
    }
    const prompt = await promptFor(context, run);
    if (prompt === null) return { kind: "blocked" };
    if (prompt === "ticket-gone") {
      // 트래커에서 티켓이 지워졌다. 영영 시작할 수 없으니 끝내 뒤 런을 막지 않는다(Q82.16).
      tryWrite(context, run.id, () =>
        recordStartFailure(db, run.id, {
          failures: records.startFailures,
          error: describe({ kind: "ticket-not-found", ticketKey: run.ticket.key }),
        }),
      );
      return endCouldNotStart(context, run);
    }
    // 보내기 직전에 쓴다. 쓰지 못하면 보내지 않는다(다시 띄웠을 때 이미 보냈는지 알 수 없게 된다).
    if (
      tryWrite(context, run.id, () => recordStartRequested(db, run.id, context.now())) === undefined
    ) {
      return { kind: "blocked" };
    }
    const started = await runner.startRun({
      mailbox,
      project: run.runnerProject,
      worktreeName: run.worktreeName,
      agent: run.agent,
      prompt: prompt.text,
      ticket: prompt.ticket,
    });
    return { kind: "started", started };
  } catch (error) {
    logger.warn("could not start run", { runId: run.id, error });
    return handleStartFailure(context, run, { runnerId, unverified }, records.startFailures, error);
  }
}

/**
 * 같은 이름으로 이미 시작한 런을 찾는다. 찾지 못했으면(오류) 시작을 보내지 않는다. 러너에 닿지 않았으면
 * "unreachable", 그 밖의 오류는 "unknown"이다. 찾기 오류는 시작 명령의 오류가 아니라 시도 횟수에 넣지 않는다.
 */
async function findStarted(
  context: TickContext,
  run: QueuedStoredRun,
  runner: Runner,
  mailbox: MailboxRef,
): Promise<StartedRun | null | "unreachable" | "unknown"> {
  try {
    return await runner.findStartedRun({ mailbox, worktreeName: run.worktreeName });
  } catch (error) {
    context.logger.warn("could not look up a started run", { runId: run.id, error });
    return isOfflineLike(error) ? "unreachable" : "unknown";
  }
}

/** 시작할 때 러너를 다시 해 보기까지 기다리는 시간(Q86). 그동안 그 러너를 Offline으로 본다. */
export const START_UNREACHABLE_RETRY_MS = 60_000;

function markUnreachable(context: TickContext, runnerId: RunnerId): void {
  context.unreachableUntil.set(runnerId, context.now().getTime() + START_UNREACHABLE_RETRY_MS);
}

/** 러너에 닿지 못했거나 런을 돌릴 준비가 안 된 오류인지(core decideStartFailure의 wait-like-offline). */
function isOfflineLike(error: unknown): boolean {
  const detail = runnerErrorDetail(error);
  return detail !== null && decideStartFailure(detail, 0).action === "wait-like-offline";
}

/**
 * 시작 실패를 core decideStartFailure대로 처리한다(Q86).
 *
 * `unverified`는 앞서 보낸 시작의 결과를 아직 확인하지 못했다는 뜻이다. 그때는 다른 러너에서 다시 시작하면
 * 에이전트가 둘 생길 수 있어, 러너를 비우거나 시작 요청 시각을 지우지 않고 그 러너에 묶어 둔다.
 * 확인했으면(또는 처음 보냈으면) 러너가 닿지 않았거나 오류로 답한 시작은 시작한 런을 남기지 않았으므로
 * (core RunnerErrorDetail) 시작 요청 시각을 지운다.
 */
function handleStartFailure(
  context: TickContext,
  run: QueuedStoredRun,
  target: { runnerId: RunnerId; unverified: boolean },
  previousFailures: number,
  error: unknown,
): StartAttempt {
  const detail = runnerErrorDetail(error);
  if (detail === null) return { kind: "blocked" };
  const { db } = context;
  const { runnerId, unverified } = target;
  // 러너가 닿지 않았거나 오류로 답했으면 시작한 런이 남지 않았다(core RunnerErrorDetail). 읽을 수 없는
  // 출력은 명령이 돈 뒤일 수 있어 지우지 않고, 다음 바퀴에 같은 이름으로 먼저 찾는다.
  const definite = detail.kind !== "malformed-output";
  const forget = (): void => {
    if (!unverified && definite) clearStartRequested(db, run.id);
  };
  const decision = decideStartFailure(detail, previousFailures);
  switch (decision.action) {
    case "wait-like-offline":
      markUnreachable(context, runnerId);
      // Offline 예외처럼 순서에서 뺀다. 결과를 모르는 시작이 없으면 러너를 비워 맞는 러너를 다시 고른다.
      if (!unverified) {
        tryWrite(context, run.id, () =>
          inTransaction(db, () => {
            forget();
            setQueuedRunRunner(db, run.id, null);
          }),
        );
      }
      return { kind: "skipped" };
    case "find-then-retry":
      return { kind: "blocked" };
    case "recreate-mailbox":
      context.mailboxes.delete(runnerId);
      tryWrite(context, run.id, () => setRunnerMailbox(db, runnerId, null));
      return { kind: "blocked" };
    case "retry":
      tryWrite(context, run.id, () =>
        inTransaction(db, () => {
          forget();
          recordStartFailure(db, run.id, { failures: decision.failures, error: describe(detail) });
        }),
      );
      return { kind: "blocked" };
    case "could-not-start": {
      const error = describe(detail);
      if (!definite) {
        // 시작했는지 모른다. 횟수만 적고, 다음 바퀴에 찾아서 없으면 그때 끝낸다.
        tryWrite(context, run.id, () =>
          recordStartFailure(db, run.id, { failures: decision.failures, error }),
        );
        return { kind: "blocked" };
      }
      tryWrite(context, run.id, () =>
        recordStartFailure(db, run.id, { failures: decision.failures, error }),
      );
      return endCouldNotStart(context, run);
    }
  }
}

/** 시작할 수 없음으로 끝낸다(Q86). PR을 찾지 않아 PR 상태는 없음이다. */
function endCouldNotStart(context: TickContext, run: QueuedStoredRun): StartAttempt {
  const ended = tryWrite(context, run.id, () =>
    changeRunState(
      context.db,
      run.id,
      { to: "ended", agentResult: "could-not-start", prState: "none" },
      context.now(),
    ),
  );
  if (ended !== undefined) reportFailure(context.logger, run.id, ended);
  return { kind: ended?.ok === true ? "skipped" : "blocked" };
}

/**
 * 에이전트에게 줄 지시. 티켓만이다(GLOSSARY Agent). 트래커 연결이 없으면 null, 트래커에서 티켓이 지워졌으면
 * "ticket-gone"이다.
 */
async function promptFor(
  context: TickContext,
  run: QueuedStoredRun,
): Promise<{ text: string; ticket: { key: TicketKey; url: string } } | null | "ticket-gone"> {
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  if (tracker === null) {
    context.logger.warn("run's tracker connection is not registered", { runId: run.id });
    return null;
  }
  const ticket = await tracker.getTicket(run.ticket.key);
  if (ticket === null) {
    context.logger.warn("run's ticket was not found in the tracker", { runId: run.id });
    return "ticket-gone";
  }
  return {
    text: `${ticket.title}\n\n${ticket.body}`,
    ticket: { key: ticket.key, url: ticket.url },
  };
}

/** 시작한 런을 Running으로 쓴다. 런이 더는 Queued가 아니면 false다. */
function recordStart(context: TickContext, runId: RunId, started: StartedRun): boolean {
  const { db, now, logger } = context;
  const result = changeRunState(db, runId, { to: "running", started }, now());
  reportFailure(logger, runId, result);
  return result.ok;
}
