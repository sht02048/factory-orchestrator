import { withLogContext } from "@ganger/log";
import { planRunControl, ticketBriefText } from "@ganger/core";
import type { RunControlFailure, RunnerErrorDetail } from "@ganger/core";
import {
  changeRunState,
  completeRunControlRequest,
  getRunWithRecords,
  hasPendingCancelRequest,
  listPendingRunControlRequests,
  markRunControlOutcomeUnknown,
} from "@ganger/db";
import type { PendingRunControlRequest } from "@ganger/db";
import { findRunner, mailboxFor, runnerErrorDetail, tryWrite } from "./context.js";
import type { ActiveRun, TickContext } from "./context.js";
import { messages } from "./messages.js";

export async function processRunControlRequests(context: TickContext): Promise<void> {
  let pending: PendingRunControlRequest[];
  try {
    pending = listPendingRunControlRequests(context.db);
  } catch (error) {
    context.logger.warn("run_control.read_failed", { error });
    return;
  }
  for (const request of pending) {
    let failure: RunControlFailure | null;
    let detail: RunnerErrorDetail | null = null;
    try {
      failure = await withLogContext({ runId: request.runId }, () =>
        applyRunControl(context, request),
      );
    } catch (error) {
      context.logger.warn("run_control.apply_failed", {
        runId: request.runId,
        control: request.control,
        error,
      });
      detail = runnerErrorDetail(error);
      failure = failureOf(detail);
    }
    if (keepTrying(context, request, detail)) continue;
    tryWrite(context, request.runId, () =>
      completeRunControlRequest(context.db, {
        runId: request.runId,
        requestedAt: request.requestedAt,
        completedAt: context.now(),
        error: failure,
      }),
    );
  }
}

function keepTrying(
  context: TickContext,
  request: PendingRunControlRequest,
  detail: RunnerErrorDetail | null,
): boolean {
  if (request.control !== "resume" || detail === null) return false;
  if (detail.kind === "start-outcome-unknown") {
    tryWrite(context, request.runId, () => markRunControlOutcomeUnknown(context.db, request));
    return true;
  }
  return request.outcomeUnknown && failureOf(detail) === "runner-unreachable";
}

async function applyRunControl(
  context: TickContext,
  request: PendingRunControlRequest,
): Promise<RunControlFailure | null> {
  const { db } = context;
  const found = getRunWithRecords(db, request.runId);
  if (found === null) return "state-changed";
  const { run } = found;
  if (run.state === "queued" || run.state === "ended") return "state-changed";
  const unknownResume =
    request.outcomeUnknown && (run.state === "paused" || run.state === "disconnected");
  if (!unknownResume && !planRunControl(run.state, request.control).ok) return "state-changed";
  const cancelling = hasPendingCancelRequest(db, run.id);
  if (cancelling && !unknownResume) return "state-changed";
  const stored = findRunner(db, run.runnerId);
  if (stored === undefined) return "runner-error";
  const runner = context.adapters.runner(stored);
  const mailbox = await mailboxFor(context, stored, runner);
  const onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
  if (request.control === "pause") {
    await runner.pauseAgent(onRunner);
    return recorded(context, run, () =>
      changeRunState(db, run.id, { to: "paused", source: "operator" }, context.now()),
    );
  }
  const resumed = await runner.resumeAgent(onRunner, {
    agent: run.agent,
    ...(run.model === null ? {} : { model: run.model }),
    message: messages.resume.message,
    restartPrompt: await restartPromptFor(context, run, found.records.agentBrief),
    startIfGone: !cancelling,
  });
  return recorded(context, run, () =>
    changeRunState(db, run.id, { to: "running", resumedAgentRef: resumed.agentRef }, context.now()),
  );
}

function recorded(
  context: TickContext,
  run: ActiveRun,
  write: () => ReturnType<typeof changeRunState>,
): RunControlFailure | null {
  const result = tryWrite(context, run.id, write);
  if (result?.ok === true) return null;
  context.logger.warn("run_control.record_failed", {
    runId: run.id,
    error: result?.ok === false ? result.error : "write failed",
  });
  return "state-changed";
}

async function restartPromptFor(
  context: TickContext,
  run: ActiveRun,
  sentBrief: string | null,
): Promise<string> {
  if (sentBrief !== null) return `${messages.resume.restartPreamble}\n\n${sentBrief}`;
  const fallback = [run.ticket.key, run.ticketTitle].filter((part) => part !== null).join(" ");
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  let ticketText = fallback;
  if (tracker !== null) {
    try {
      const ticket = await tracker.getTicket(run.ticket.key);
      if (ticket !== null) ticketText = ticketBriefText(ticket);
    } catch (error) {
      context.logger.warn("run_control.ticket_read_failed", {
        runId: run.id,
        error,
      });
    }
  }
  return `${messages.resume.restartPreamble}\n\n${ticketText}`;
}

export function failureOf(detail: RunnerErrorDetail | null): RunControlFailure {
  if (detail === null) return "runner-error";
  switch (detail.kind) {
    case "unreachable":
    case "not-ready":
    case "not-installed":
      return "runner-unreachable";
    case "runner-error":
      return detail.code === "agent_not_running" ? "agent-not-running" : "runner-error";
    case "mailbox-missing":
    case "start-outcome-unknown":
    case "malformed-output":
      return "runner-error";
  }
}
