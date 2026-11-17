import {
  LAST_LOG_LINES,
  completeLogTailRequest,
  completeRunnerCheckRequest,
  getRunWithRecords,
  listPendingLogTailRequests,
  listPendingRunnerCheckRequests,
} from "@factory/db";
import type { RunId, RunnerHealth, RunnerId } from "@factory/core";
import { describe, findRunner, mailboxFor, runnerErrorDetail, tryWrite } from "./context.js";
import type { TickContext } from "./context.js";
import { checkRunner } from "./runner-check.js";

/**
 * web이 DB에 남긴 요청을 처리한다(Q61). web은 ssh를 쓰지 않아 러너에 닿는 일은 worker가 대신한다.
 * 결과 쓰기는 요청 시각이 같고 아직 끝나지 않은 요청에만 되므로 요청 하나는 한 번만 처리한다. 처리하는 동안
 * 새 요청이 와서 덮어썼으면 쓰지 않고 다음 바퀴에 새 요청을 처리한다.
 *
 * 실패는 결과의 `error`에 JSON(`{"kind": ...}`)으로 쓴다. 러너 어댑터 오류는 core RunnerErrorDetail 그대로다.
 */
export async function processWebRequests(context: TickContext): Promise<void> {
  await processLogTailRequests(context);
  await processRunnerCheckRequests(context);
}

/**
 * 로그 꼬리 요청(Run 상세, Q46). 끝나지 않은 런은 러너에서 마지막 줄들을 읽는다. 끝난 런은 끝날 때 저장한
 * 마지막 로그를 돌려준다. 결과는 화면에 보일 임시 값이라 런 기록에 남기지 않는다.
 */
async function processLogTailRequests(context: TickContext): Promise<void> {
  for (const request of listPendingLogTailRequests(context.db)) {
    const complete = (result: { lines: ReadonlyArray<string> } | { error: string }): void => {
      tryWrite(context, request.runId, () =>
        completeLogTailRequest(context.db, {
          runId: request.runId,
          requestedAt: request.requestedAt,
          completedAt: context.now(),
          ...result,
        }),
      );
    };
    try {
      complete(await readLogTail(context, request.runId));
    } catch (error) {
      context.logger.warn("could not read a log tail", { runId: request.runId, error });
      complete({ error: errorText(error) });
    }
  }
}

async function readLogTail(
  context: TickContext,
  runId: RunId,
): Promise<{ lines: ReadonlyArray<string> } | { error: string }> {
  const found = getRunWithRecords(context.db, runId);
  if (found === null) return { error: describe({ kind: "run-not-found" }) };
  const { run, records } = found;
  if (run.state === "ended") return { lines: records.lastLog ?? [] };
  if (run.state === "queued") return { error: describe({ kind: "run-not-started" }) };
  const stored = findRunner(context.db, run.runnerId);
  if (stored === undefined) return { error: describe({ kind: "runner-not-registered" }) };
  const runner = context.adapters.runner(stored);
  const mailbox = await mailboxFor(context, stored, runner);
  const lines = await runner.readLogTail(
    { mailbox, worktree: run.worktree, agentRef: run.agentRef },
    { lines: LAST_LOG_LINES },
  );
  return { lines };
}

/**
 * 러너 확인 요청(온보딩·Settings). 주기적 러너 확인과 같이 확인 결과를 러너에 쓰고, 요청에는 그때의
 * RunnerHealth를 쓴다.
 */
async function processRunnerCheckRequests(context: TickContext): Promise<void> {
  for (const request of listPendingRunnerCheckRequests(context.db)) {
    const outcome = await checkRequestedRunner(context, request.runnerId);
    try {
      completeRunnerCheckRequest(context.db, {
        runnerId: request.runnerId,
        requestedAt: request.requestedAt,
        completedAt: context.now(),
        ...outcome,
      });
    } catch (error) {
      context.logger.warn("could not write a runner check result", {
        runnerId: request.runnerId,
        error,
      });
    }
  }
}

async function checkRequestedRunner(
  context: TickContext,
  runnerId: RunnerId,
): Promise<{ result: RunnerHealth } | { error: string }> {
  const stored = findRunner(context.db, runnerId);
  if (stored === undefined) return { error: describe({ kind: "runner-not-registered" }) };
  try {
    const checked = await checkRunner(context, stored);
    return checked.ok ? { result: checked.health } : { error: describe(checked.error) };
  } catch (error) {
    context.logger.warn("could not check a runner on request", { runnerId, error });
    return { error: errorText(error) };
  }
}

function errorText(error: unknown): string {
  return describe(
    runnerErrorDetail(error) ?? {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    },
  );
}
