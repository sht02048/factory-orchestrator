import { canRunnerTake, decideStartFailure, MAX_START_RETRIES, planQueue } from "@ganger/core";
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
} from "@ganger/core";
import {
  changeRunState,
  fillRunTicketTitle,
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
} from "@ganger/db";
import type { SecretBox, StoredRun } from "@ganger/db";
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
  dbPath: string;
  registry: AdapterRegistry;
  secretBox: SecretBox;
  now?: () => Date;
  logger?: WorkerLogger;
}

export interface Worker {
  tick(): Promise<void>;
  close(): Promise<void>;
}

export interface RunningWorker {
  stop(): Promise<void>;
}

const consoleLogger: WorkerLogger = {
  warn: (message, fields) => console.warn(`[worker] ${message}`, fields ?? {}),
};

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
  await checkRunners(context);
  await processWebRequests(context, "runner-check");
  await watchActiveRuns(context);
  await cancelQueuedRuns(context);
  await assignAutomatically(context);
  await processQueue(context);
  await processAfterRuns(context);
  await processWebRequests(context, "log-tail");
}

async function cancelQueuedRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  for (const request of listPendingCancelRequests(db)) {
    const found = getRunWithRecords(db, request.runId);
    if (found?.run.state !== "queued") continue;
    const { run, records } = found;
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

async function processQueue(context: TickContext): Promise<void> {
  const { db, pendingStarts, now } = context;
  recordPendingStarts(context);

  const plan = inTransaction(db, () => {
    const queued = listRuns(db, { states: ["queued"] });
    if (queued.length === 0) return null;
    const runners = listRunnerSnapshots(db, now()).map((runner) =>
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
      .map((run) => (bound.has(run.id) ? { ...run, unstartable: false } : run))
      .filter((run) => !hasPendingCancelRequest(db, run.id))
      .filter((run) => {
        const runnerId = bound.get(run.id);
        if (runnerId === undefined) return true;
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

function toQueuedRun(context: TickContext, run: StoredRun): QueuedRun[] {
  if (run.state !== "queued") return [];
  const mapping = getMapping(context.db, run.ticket.connection, run.trackerProject);
  return [
    {
      id: run.id,
      assignedAt: run.assignedAt,
      project: run.runnerProject,
      agent: run.agent,
      runnerId: run.runnerId,
      unstartable: mapping === null,
    },
  ];
}

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
  let unverified = records.startRequestedAt !== null;
  let mailbox: MailboxRef;
  try {
    mailbox = await mailboxFor(context, storedRunner, runner);
  } catch (error) {
    logger.warn("could not prepare the runner's mailbox", { runId: run.id, error });
    if (!isOfflineLike(error)) return { kind: "blocked" };
    markUnreachable(context, runnerId);
    if (!unverified) tryWrite(context, run.id, () => setQueuedRunRunner(db, run.id, null));
    return { kind: "skipped" };
  }
  try {
    if (unverified) {
      const existing = await findStarted(context, run, runner, mailbox);
      if (existing === "unreachable") {
        markUnreachable(context, runnerId);
        return { kind: "skipped" };
      }
      if (existing === "unknown") return { kind: "skipped" };
      if (existing !== null) return { kind: "started", started: existing };
      unverified = false;
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
      tryWrite(context, run.id, () =>
        recordStartFailure(db, run.id, {
          failures: records.startFailures,
          error: describe({ kind: "ticket-not-found", ticketKey: run.ticket.key }),
        }),
      );
      return endCouldNotStart(context, run);
    }
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
      ...(run.model === null ? {} : { model: run.model }),
      prompt: prompt.text,
      ticket: prompt.ticket,
    });
    return { kind: "started", started };
  } catch (error) {
    logger.warn("could not start run", { runId: run.id, error });
    return handleStartFailure(context, run, { runnerId, unverified }, records.startFailures, error);
  }
}

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

export const START_UNREACHABLE_RETRY_MS = 60_000;

function markUnreachable(context: TickContext, runnerId: RunnerId): void {
  context.unreachableUntil.set(runnerId, context.now().getTime() + START_UNREACHABLE_RETRY_MS);
}

function isOfflineLike(error: unknown): boolean {
  const detail = runnerErrorDetail(error);
  return detail !== null && decideStartFailure(detail, 0).action === "wait-like-offline";
}

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
  const definite = detail.kind !== "malformed-output";
  const forget = (): void => {
    if (!unverified && definite) clearStartRequested(db, run.id);
  };
  const decision = decideStartFailure(detail, previousFailures);
  switch (decision.action) {
    case "wait-like-offline":
      markUnreachable(context, runnerId);
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
  tryWrite(context, run.id, () => fillRunTicketTitle(context.db, run.id, ticket.title));
  return {
    text: `${ticket.title}\n\n${ticket.body}`,
    ticket: { key: ticket.key, url: ticket.url },
  };
}

function recordStart(context: TickContext, runId: RunId, started: StartedRun): boolean {
  const { db, now, logger } = context;
  const result = changeRunState(db, runId, { to: "running", started }, now());
  reportFailure(logger, runId, result);
  return result.ok;
}
