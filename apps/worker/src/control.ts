import { planRunControl } from "@ganger/core";
import type { RunControlFailure, RunnerErrorDetail } from "@ganger/core";
import {
  changeRunState,
  completeRunControlRequest,
  getRunWithRecords,
  hasPendingCancelRequest,
  listPendingRunControlRequests,
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
    context.logger.warn("could not read run control requests", { error });
    return;
  }
  for (const request of pending) {
    let failure: RunControlFailure | null;
    try {
      failure = await applyRunControl(context, request);
    } catch (error) {
      context.logger.warn("could not apply a run control request", {
        runId: request.runId,
        control: request.control,
        error,
      });
      failure = failureOf(runnerErrorDetail(error));
    }
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

async function applyRunControl(
  context: TickContext,
  request: PendingRunControlRequest,
): Promise<RunControlFailure | null> {
  const { db } = context;
  const run = getRunWithRecords(db, request.runId)?.run;
  if (run === undefined || run.state === "queued" || run.state === "ended") return "state-changed";
  if (!planRunControl(run.state, request.control).ok) return "state-changed";
  if (hasPendingCancelRequest(db, run.id)) return "state-changed";
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
    restartPrompt: await restartPromptFor(context, run),
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
  context.logger.warn("could not record a run control change", {
    runId: run.id,
    error: result?.ok === false ? result.error : "write failed",
  });
  return "state-changed";
}

async function restartPromptFor(context: TickContext, run: ActiveRun): Promise<string> {
  const fallback = [run.ticket.key, run.ticketTitle].filter((part) => part !== null).join(" ");
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  let ticketText = fallback;
  if (tracker !== null) {
    try {
      const ticket = await tracker.getTicket(run.ticket.key);
      if (ticket !== null) ticketText = `${ticket.title}\n\n${ticket.body}`;
    } catch (error) {
      context.logger.warn("could not read the ticket for a restarted agent", {
        runId: run.id,
        error,
      });
    }
  }
  return `${messages.resume.restartPreamble}\n\n${ticketText}`;
}

function failureOf(detail: RunnerErrorDetail | null): RunControlFailure {
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
