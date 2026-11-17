import { decideConnection, decideTimeout, resolveRunProgress } from "@factory/core";
import type {
  AgentResult,
  CompletionReport,
  PermissionRequestId,
  PrStateDecision,
  QuestionId,
  RunOnRunner,
  RunProgress,
  Runner,
} from "@factory/core";
import {
  DEFAULT_MAX_RUN_MS,
  changeRunState,
  getRunWithRecords,
  hasPendingCancelRequest,
  inTransaction,
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
} from "@factory/db";
import type { RunRecords, StoredRunner } from "@factory/db";
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

/**
 * Running·Waiting for Input·Disconnected 런을 감시한다(스펙 3절 5·6번). 런마다 아래 순서로 본다.
 *
 * 1. 러너에 닿아 실제 상태를 읽는다(core RunProgress). 닿으면 연결 끊김 시계를 되돌리고, 받은 질문을 DB에
 *    쓰고, 운영자가 남긴 답을 보낸다.
 * 2. 끝낼지 정한다. 처리하지 않은 취소 요청이 있으면 취소가 이긴다(운영자가 취소함). 그다음은 실제 상태가
 *    끝났는지(완료 보고, 보고 없이 사라짐, 워크트리 사라짐), 그다음은 최대 실행 시간이다(core decideTimeout).
 * 3. 끝내면 PR 상태를 정하고, 에이전트를 멈추거나 닫은 뒤 두 축을 한 번 기록한다. PR을 찾지 못했거나
 *    에이전트를 멈추지 못하면 기록하지 않고 다음 바퀴에 다시 한다(취소면 화면은 "취소 중", Q82.11).
 * 4. 끝내지 않으면 실제 상태로 Running·Waiting for Input을 오간다. Disconnected에서 다시 닿았을 때도 같다(Q67).
 *
 * 러너에 닿지 않으면 연결 끊김 규칙을 따른다(whileUnreachable). Disconnected 동안에는 러너를 고치는 호출
 * (에이전트 멈추기, 워크트리 지우기)을 하지 않는다. 시계는 모두 DB의 시각으로 계산해 재시작 뒤에도 이어진다.
 */
export async function watchActiveRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  const runnersById = new Map(listRunners(db).map((runner) => [runner.id, runner]));
  const maxRunMs = new Map(listWorkspaces(db).map((ws) => [ws.id, ws.maxRunMs]));
  for (const run of listRuns(db, { states: ["running", "waiting-for-input", "disconnected"] })) {
    if (run.state === "queued" || run.state === "ended") continue;
    try {
      await watchRun(context, run, runnersById.get(run.runnerId), {
        maxRunMs: maxRunMs.get(run.workspaceId) ?? DEFAULT_MAX_RUN_MS,
      });
    } catch (error) {
      // 이번 바퀴에 처리하지 못했으면 다음 바퀴에 다시 본다.
      logger.warn("could not watch run", { runId: run.id, error });
    }
  }
}

interface WatchSettings {
  maxRunMs: number;
}

async function watchRun(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner | undefined,
  settings: WatchSettings,
): Promise<void> {
  const { db, logger, adapters } = context;
  if (storedRunner === undefined) {
    logger.warn("run's runner is not registered", { runId: run.id, runnerId: run.runnerId });
    return;
  }
  const records = getRunWithRecords(db, run.id)?.records;
  if (records === undefined) return;
  const cancelRequested = hasPendingCancelRequest(db, run.id);
  const runner = adapters.runner(storedRunner);

  let onRunner: RunOnRunner;
  let progress: RunProgress;
  try {
    const mailbox = await mailboxFor(context, storedRunner, runner);
    onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
    progress = await runner.pollRun(onRunner);
  } catch (error) {
    if (!isUnreachable(error)) {
      // 러너에는 닿았다(출력 오류 등). 연속으로 닿지 않은 것이 아니니 5분 시계를 되돌린다(Q50).
      if (records.unreachableSince !== null) {
        tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince: null }));
      }
      throw error;
    }
    await whileUnreachable(context, run, records, { ...settings, cancelRequested });
    return;
  }

  // 닿았다. 5분 시계를 되돌린다(Q50).
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
    await sendDenials(context, run, runner, onRunner);
  }

  const resolution = resolveRunProgress(progress, {
    answered: answeredQuestions(context, run),
    denied: deniedPermissions(context, run),
  });
  // 앞 바퀴에 에이전트를 멈추거나 닫았는데 기록하지 못했으면 그때 정한 결과로 기록만 다시 한다. 멈춘 뒤의
  // 실제 상태(보고 없이 사라짐)로 다시 정하면 에이전트 결과가 바뀐다.
  const pending = context.pendingEndings.get(run.id);
  const ending =
    pending === undefined
      ? decideEnding(context, run, {
          progress,
          resolution,
          cancelRequested,
          maxRunMs: settings.maxRunMs,
        })
      : { ...pending, agent: "none" as const };
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

  // PR을 찾지 못하면(코드 호스트 오류) 에이전트를 건드리지 않고 다음 바퀴에 다시 본다.
  const decision = await decideRunPrState(context, run);
  // 멈추거나 닫지 못하면 던져 기록하지 않는다. 다음 바퀴에 다시 해 본다(Q82.11).
  if (ending.agent === "stop") await runner.stopAgent(onRunner);
  if (ending.agent === "close") await runner.closeAgent(onRunner);
  context.pendingEndings.set(run.id, { agentResult: ending.agentResult, report: ending.report });
  endRun(context, run, {
    agentResult: ending.agentResult,
    decision,
    runnerUnreached: false,
    report: ending.report,
  });
  context.pendingEndings.delete(run.id);
}

interface Ending extends PendingEnding {
  /** 기록 전에 에이전트에게 할 일. 멈추기는 아직 도는 에이전트를, 닫기는 완료 보고를 보낸 에이전트를 끝낸다 */
  agent: "stop" | "close" | "none";
}

function decideEnding(
  context: TickContext,
  run: ActiveRun,
  input: {
    progress: RunProgress;
    resolution: ReturnType<typeof resolveRunProgress>;
    cancelRequested: boolean;
    maxRunMs: number;
  },
): Ending | null {
  const { progress, resolution } = input;
  // 끝나지 않은 런의 취소는 지금 상태의 규칙으로 처리한다(스펙 3절 6번). 에이전트가 이미 끝났어도 운영자가
  // 취소함으로 끝내고, 살아 있는 에이전트만 멈추거나 닫는다.
  if (input.cancelRequested) {
    return {
      agentResult: "canceled",
      agent: progress.kind === "active" ? "stop" : progress.kind === "reported" ? "close" : "none",
      report: progress.kind === "reported" ? progress.report : null,
    };
  }
  if (resolution.kind === "end") {
    // 대화형 에이전트는 완료 보고 뒤에도 살아 있어 닫는다(Q82.2·Q82.19).
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
    cancelRequested: false,
  });
  if (timeout === null) return null;
  return { agentResult: timeout.agentResult, agent: "stop", report: null };
}

/**
 * 러너에 닿지 않을 때(Q50·Q67·Q82.21).
 * - Running·Waiting for Input: 처음 닿지 않은 시각을 DB에 두고, 5분 동안 계속 닿지 않으면 Disconnected로
 *   바꾼다(core decideConnection). 5분 안이면 상태를 바꾸지 않는다. 최대 실행 시간이 지났어도 에이전트를
 *   멈출 수 없으니 기다린다. 계속 닿지 않으면 Disconnected를 거쳐 아래 규칙으로 끝난다.
 * - Disconnected: 러너에 명령하지 않는다. 최대 실행 시간이 지나면 러너 연결 끊김으로, 취소 중이면 러너에
 *   닿지 못한 채 운영자가 취소함으로 끝내고 PR 상태를 함께 기록한다(core decideTimeout).
 */
async function whileUnreachable(
  context: TickContext,
  run: ActiveRun,
  records: RunRecords,
  input: WatchSettings & { cancelRequested: boolean },
): Promise<void> {
  const { db, logger, now } = context;
  if (run.state === "disconnected") {
    const timeout = decideTimeout({
      state: run.state,
      startedAt: run.startedAt,
      now: now(),
      maxRunMs: input.maxRunMs,
      cancelRequested: input.cancelRequested,
    });
    if (timeout === null) return;
    const decision = await decideRunPrState(context, run);
    endRun(context, run, {
      agentResult: timeout.agentResult,
      decision,
      runnerUnreached: timeout.runnerUnreached,
      report: null,
    });
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

/**
 * 두 축을 한 번 기록한다(ADR 0004, Q69). 운영자가 취소함이면 같은 트랜잭션에서 취소 요청을 처리했다고
 * 표시한다(한 번만). 워크트리 처리는 요약 계산 함수가 정하고 뒤처리는 0017이 한다.
 */
function endRun(
  context: TickContext,
  run: ActiveRun,
  input: {
    agentResult: AgentResult;
    decision: PrStateDecision;
    runnerUnreached: boolean;
    report: CompletionReport | null;
  },
): void {
  const { db, logger } = context;
  const endedAt = context.now();
  inTransaction(db, () => {
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
      return;
    }
    if (input.agentResult === "canceled") markCancelRequestProcessed(db, run.id, endedAt);
    // 끝난 런의 권한 대기는 더 이상 열려 있지 않다. 손댈 일에 남지 않게 닫는다.
    resolvePermissionWaits(db, run.id, [], endedAt);
    if (input.decision.pr !== null) {
      const { id, displayId, url, ci } = input.decision.pr;
      updateRunRecords(db, run.id, {
        pullRequest: { id, displayId, url, ci, checkedAt: endedAt },
      });
    }
  });
}

/**
 * 운영자가 web에서 남긴 답을 러너에 보낸다(Q82.3). 답했는지는 DB가 기준이라(Q82.5) 보낸 뒤 보냈다고 한 번만
 * 표시하고, 표시한 답은 다시 보내지 않는다. 표시를 쓰지 못하면 데몬이 살아 있는 동안 메모리에 두어 다시
 * 보내지 않고 표시만 다시 쓴다.
 */
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

/**
 * 운영자가 web에서 남긴 권한 거절을 러너에 보낸다(Q82.4). 답 보내기와 같이 보낸 뒤 한 번만 표시하고, 표시를
 * 쓰지 못하면 데몬이 살아 있는 동안 메모리에 두어 다시 보내지 않는다. 허용은 러너 화면에서 사람만 한다.
 */
async function sendDenials(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
): Promise<void> {
  const { db, logger, unmarkedDenials } = context;
  for (const denial of listUnsentDenials(db)) {
    if (denial.runId !== run.id) continue;
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

/** 거절을 보낸 권한 대기. DB에 표시한 것과 보냈지만 아직 표시하지 못한 것이다. */
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

/** 답을 보낸 질문. DB에 표시한 것과 보냈지만 아직 표시하지 못한 것이다. */
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
