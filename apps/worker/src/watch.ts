import { decideConnection, decideTimeout, resolveRunProgress } from "@ganger/core";
import type {
  AgentResult,
  CompletionReport,
  PermissionRequestId,
  PrStateDecision,
  QuestionId,
  RunOnRunner,
  RunProgress,
  Runner,
} from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  LAST_LOG_LINES,
  changeRunState,
  getRunWithRecords,
  hasPendingCancelRequest,
  inTransaction,
  lastStateBeforeDisconnect,
  listRunners,
  listRuns,
  listUnsentAnswers,
  listUnsentDenials,
  listWorkspaces,
  markAnswerSent,
  markDenialSent,
  markCancelRequestProcessed,
  recordPermissionWaits,
  recordRunQuestions,
  resolvePermissionWaits,
  sentDenialIds,
  sentQuestionIds,
  updateRunRecords,
} from "@ganger/db";
import type { RunRecords, StoredRunner } from "@ganger/db";
import {
  answerKey,
  decideRunPrState,
  denialKey,
  isUnreachable,
  mailboxFor,
  reportFailure,
  tryWrite,
} from "./context.js";
import type { ActiveRun, PendingEnding, TickContext } from "./context.js";

export async function watchActiveRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  const runnersById = new Map(listRunners(db).map((runner) => [runner.id, runner]));
  const maxRunMs = new Map(listWorkspaces(db).map((ws) => [ws.id, ws.maxRunMs]));
  for (const run of listRuns(db, {
    states: ["running", "waiting-for-input", "paused", "disconnected"],
  })) {
    if (run.state === "queued" || run.state === "ended") continue;
    try {
      await watchRun(context, run, runnersById.get(run.runnerId), {
        maxRunMs: maxRunMs.get(run.workspaceId) ?? DEFAULT_MAX_RUN_MS,
      });
    } catch (error) {
      logger.warn("could not watch run", { runId: run.id, error });
    }
  }
}

interface WatchSettings {
  maxRunMs: number;
  pausedMs: number;
}

async function watchRun(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner | undefined,
  limits: { maxRunMs: number },
): Promise<void> {
  const { db, logger, adapters } = context;
  const records = getRunWithRecords(db, run.id)?.records;
  if (records === undefined) return;
  const settings: WatchSettings = { maxRunMs: limits.maxRunMs, pausedMs: records.pausedMs };
  const cancelRequested = hasPendingCancelRequest(db, run.id);
  if (storedRunner === undefined) {
    logger.warn("run's runner is not registered", { runId: run.id, runnerId: run.runnerId });
    await endIfTimedOut(context, run, { ...settings, cancelRequested, state: "disconnected" });
    return;
  }
  const runner = adapters.runner(storedRunner);

  let onRunner: RunOnRunner;
  let progress: RunProgress;
  try {
    const mailbox = await mailboxFor(context, storedRunner, runner);
    onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
    progress = await runner.pollRun(onRunner);
  } catch (error) {
    if (!isUnreachable(error)) {
      if (records.unreachableSince !== null) {
        tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince: null }));
      }
      const ended = await endWithoutProgress(context, run, storedRunner, runner, {
        ...settings,
        cancelRequested,
      });
      if (ended) return;
      throw error;
    }
    await whileUnreachable(context, run, records, { ...settings, cancelRequested });
    return;
  }

  if (records.unreachableSince !== null) {
    tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince: null }));
  }
  if (progress.kind === "active") {
    tryWrite(context, run.id, () => recordRunQuestions(db, run.id, progress.questions));
    await sendAnswers(context, run, runner, onRunner);
    tryWrite(context, run.id, () =>
      inTransaction(db, () => {
        recordPermissionWaits(db, run.id, progress.permissionWaits);
        resolvePermissionWaits(
          db,
          run.id,
          progress.permissionWaits.map((wait) => wait.id),
          context.now(),
        );
      }),
    );
    await sendDenials(
      context,
      run,
      runner,
      onRunner,
      new Set(progress.permissionWaits.map((wait) => wait.id)),
    );
  }

  const resolution = keepPausedRunPaused(
    context,
    run,
    resolveRunProgress(progress, {
      answered: answeredQuestions(context, run),
      denied: deniedPermissions(context, run),
    }),
  );
  const pending = context.pendingEndings.get(run.id);
  const ending =
    pending === undefined
      ? decideEnding(context, run, {
          progress,
          resolution,
          cancelRequested,
          maxRunMs: settings.maxRunMs,
          pausedMs: settings.pausedMs,
        })
      : { agentResult: pending.agentResult, report: pending.report, agent: "none" as const };
  if (ending === null) {
    if (resolution.kind === "continue" && resolution.state !== run.state) {
      reportFailure(
        logger,
        run.id,
        changeRunState(db, run.id, { to: resolution.state }, context.now()),
      );
    }
    return;
  }

  const decision = await decideRunPrState(context, run);
  const lastLog =
    pending === undefined ? await readLastLog(context, run, runner, onRunner) : pending.lastLog;
  if (ending.agent === "stop") await runner.stopAgent(onRunner);
  if (ending.agent === "close") await runner.closeAgent(onRunner);
  context.pendingEndings.set(run.id, {
    agentResult: ending.agentResult,
    report: ending.report,
    lastLog,
  });
  const recorded = endRun(context, run, {
    agentResult: ending.agentResult,
    decision,
    runnerUnreached: false,
    report: ending.report,
    lastLog,
  });
  if (recorded) context.pendingEndings.delete(run.id);
}

async function endWithoutProgress(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner,
  runner: Runner,
  input: WatchSettings & { cancelRequested: boolean },
): Promise<boolean> {
  const timeout = decideTimeout({
    state: run.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    cancelRequested: input.cancelRequested,
  });
  const ending =
    timeout ??
    (input.cancelRequested && run.state !== "disconnected"
      ? { agentResult: "canceled" as const, stopAgent: true, runnerUnreached: false }
      : null);
  if (ending === null) return false;
  const decision = await decideRunPrState(context, run);
  if (ending.stopAgent && !context.pendingEndings.has(run.id)) {
    const mailbox = context.mailboxes.get(storedRunner.id) ?? storedRunner.mailbox;
    if (mailbox === null) return false;
    const onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
    const lastLog = await readLastLog(context, run, runner, onRunner);
    await runner.stopAgent(onRunner);
    context.pendingEndings.set(run.id, { agentResult: ending.agentResult, report: null, lastLog });
  }
  const recorded = endRun(context, run, {
    agentResult: ending.agentResult,
    decision,
    runnerUnreached: ending.runnerUnreached,
    report: null,
    lastLog: context.pendingEndings.get(run.id)?.lastLog ?? null,
  });
  if (recorded) context.pendingEndings.delete(run.id);
  return recorded;
}

async function endIfTimedOut(
  context: TickContext,
  run: ActiveRun,
  input: WatchSettings & { cancelRequested: boolean; state: "disconnected" },
): Promise<void> {
  const timeout = decideTimeout({
    state: input.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    cancelRequested: input.cancelRequested,
  });
  if (timeout === null) return;
  const decision = await decideRunPrState(context, run);
  endRun(context, run, {
    agentResult: timeout.agentResult,
    decision,
    runnerUnreached: timeout.runnerUnreached,
    report: null,
    lastLog: null,
  });
}

async function readLastLog(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
): Promise<ReadonlyArray<string> | null> {
  try {
    return await runner.readLogTail(onRunner, { lines: LAST_LOG_LINES });
  } catch (error) {
    context.logger.warn("could not read the last log of an ending run", { runId: run.id, error });
    return null;
  }
}

type WatchResolution =
  | ReturnType<typeof resolveRunProgress>
  | { kind: "continue"; state: "paused" };

function keepPausedRunPaused(
  context: TickContext,
  run: ActiveRun,
  resolution: ReturnType<typeof resolveRunProgress>,
): WatchResolution {
  const paused =
    run.state === "paused" ||
    (run.state === "disconnected" && lastStateBeforeDisconnect(context.db, run.id) === "paused");
  if (!paused) return resolution;
  if (resolution.kind === "continue" || resolution.agentResult === "ended-without-report") {
    return { kind: "continue", state: "paused" };
  }
  return resolution;
}

interface Ending extends Omit<PendingEnding, "lastLog"> {
  agent: "stop" | "close" | "none";
}

function decideEnding(
  context: TickContext,
  run: ActiveRun,
  input: {
    progress: RunProgress;
    resolution: WatchResolution;
    cancelRequested: boolean;
    maxRunMs: number;
    pausedMs: number;
  },
): Ending | null {
  const { progress, resolution } = input;
  if (input.cancelRequested) {
    return {
      agentResult: "canceled",
      agent: progress.kind === "active" ? "stop" : progress.kind === "reported" ? "close" : "none",
      report: progress.kind === "reported" ? progress.report : null,
    };
  }
  if (resolution.kind === "end") {
    return {
      agentResult: resolution.agentResult,
      agent: resolution.report === null ? "none" : "close",
      report: resolution.report,
    };
  }
  const timeout = decideTimeout({
    state: resolution.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    cancelRequested: false,
  });
  if (timeout === null) return null;
  return { agentResult: timeout.agentResult, agent: "stop", report: null };
}

async function whileUnreachable(
  context: TickContext,
  run: ActiveRun,
  records: RunRecords,
  input: WatchSettings & { cancelRequested: boolean },
): Promise<void> {
  const { db, logger, now } = context;
  if (run.state === "disconnected") {
    await endIfTimedOut(context, run, { ...input, state: run.state });
    return;
  }

  const unreachableSince = records.unreachableSince ?? now();
  if (records.unreachableSince === null) {
    tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince }));
  }
  if (decideConnection({ state: run.state, unreachableSince, now: now() }) === "disconnect") {
    reportFailure(logger, run.id, changeRunState(db, run.id, { to: "disconnected" }, now()));
  }
}

function endRun(
  context: TickContext,
  run: ActiveRun,
  input: {
    agentResult: AgentResult;
    decision: PrStateDecision;
    runnerUnreached: boolean;
    report: CompletionReport | null;
    lastLog: ReadonlyArray<string> | null;
  },
): boolean {
  const { db, logger } = context;
  const endedAt = context.now();
  return inTransaction(db, () => {
    const result = changeRunState(
      db,
      run.id,
      {
        to: "ended",
        agentResult: input.agentResult,
        prState: input.decision.prState,
        runnerUnreached: input.runnerUnreached,
        ...(input.report === null ? {} : { reportBody: input.report.body }),
      },
      endedAt,
    );
    if (!result.ok) {
      reportFailure(logger, run.id, result);
      return false;
    }
    if (input.agentResult === "canceled") markCancelRequestProcessed(db, run.id, endedAt);
    resolvePermissionWaits(db, run.id, [], endedAt);
    if (input.lastLog !== null) updateRunRecords(db, run.id, { lastLog: [...input.lastLog] });
    const pr = input.decision.pr;
    updateRunRecords(db, run.id, {
      pullRequest:
        pr === null
          ? null
          : { id: pr.id, displayId: pr.displayId, url: pr.url, ci: pr.ci, checkedAt: endedAt },
    });
    return true;
  });
}

async function sendAnswers(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
): Promise<void> {
  const { db, logger, unmarkedAnswers } = context;
  for (const answer of listUnsentAnswers(db)) {
    if (answer.runId !== run.id) continue;
    const key = answerKey(run.id, answer.questionId);
    if (!unmarkedAnswers.has(key)) {
      try {
        await runner.answerQuestion(onRunner, {
          questionId: answer.questionId,
          answer: answer.answer,
        });
      } catch (error) {
        logger.warn("could not send an answer", {
          runId: run.id,
          questionId: answer.questionId,
          error,
        });
        continue;
      }
      unmarkedAnswers.add(key);
    }
    const marked = tryWrite(context, run.id, () =>
      markAnswerSent(db, { runId: run.id, questionId: answer.questionId }, context.now()),
    );
    if (marked !== undefined) unmarkedAnswers.delete(key);
  }
}

async function sendDenials(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
  open: ReadonlySet<PermissionRequestId>,
): Promise<void> {
  const { db, logger, unmarkedDenials } = context;
  for (const denial of listUnsentDenials(db)) {
    if (denial.runId !== run.id || !open.has(denial.permissionId)) continue;
    const key = denialKey(run.id, denial.permissionId);
    if (!unmarkedDenials.has(key)) {
      try {
        await runner.denyPermission(onRunner, {
          permissionId: denial.permissionId,
          reason: denial.reason,
        });
      } catch (error) {
        logger.warn("could not send a permission denial", {
          runId: run.id,
          permissionId: denial.permissionId,
          error,
        });
        continue;
      }
      unmarkedDenials.add(key);
    }
    const marked = tryWrite(context, run.id, () =>
      markDenialSent(db, { runId: run.id, permissionId: denial.permissionId }, context.now()),
    );
    if (marked !== undefined) unmarkedDenials.delete(key);
  }
}

function deniedPermissions(context: TickContext, run: ActiveRun): Set<PermissionRequestId> {
  const denied = sentDenialIds(context.db, run.id);
  for (const denial of listUnsentDenials(context.db)) {
    if (
      denial.runId === run.id &&
      context.unmarkedDenials.has(denialKey(run.id, denial.permissionId))
    ) {
      denied.add(denial.permissionId);
    }
  }
  return denied;
}

function answeredQuestions(context: TickContext, run: ActiveRun): Set<QuestionId> {
  const answered = sentQuestionIds(context.db, run.id);
  for (const answer of listUnsentAnswers(context.db)) {
    if (
      answer.runId === run.id &&
      context.unmarkedAnswers.has(answerKey(run.id, answer.questionId))
    ) {
      answered.add(answer.questionId);
    }
  }
  return answered;
}
