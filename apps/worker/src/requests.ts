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

export async function processWebRequests(
  context: TickContext,
  kind: "log-tail" | "runner-check",
): Promise<void> {
  try {
    if (kind === "log-tail") await processLogTailRequests(context);
    else await processRunnerCheckRequests(context);
  } catch (error) {
    context.logger.warn("could not process web requests", { kind, error });
  }
}

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
