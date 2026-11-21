import { withLogContext } from "@ganger/log";
import { AGENT_ALREADY_FINISHED, agentMessageStep } from "@ganger/core";
import type { AgentMessageFailure, MailboxRef, RunnerErrorDetail } from "@ganger/core";
import {
  completeAgentMessage,
  getRunControlRequest,
  getRunWithRecords,
  hasPendingCancelRequest,
  listPendingAgentMessages,
  markAgentMessageSending,
  setRunnerMailbox,
} from "@ganger/db";
import type { PendingAgentMessage } from "@ganger/db";
import { findRunner, mailboxFor, runnerErrorDetail, tryWrite } from "./context.js";
import type { TickContext } from "./context.js";
import { failureOf } from "./control.js";

export async function processAgentMessages(context: TickContext): Promise<void> {
  let pending: PendingAgentMessage[];
  try {
    pending = listPendingAgentMessages(context.db);
  } catch (error) {
    context.logger.warn("agent_message.read_failed", { error });
    return;
  }
  for (const message of pending) {
    try {
      await withLogContext({ runId: message.runId }, () => deliver(context, message));
    } catch (error) {
      context.logger.warn("agent_message.read_failed", { runId: message.runId, error });
    }
  }
}

async function deliver(context: TickContext, message: PendingAgentMessage): Promise<void> {
  if (message.sendStartedAt !== null) {
    finish(context, message, "outcome-unknown");
    return;
  }
  const found = getRunWithRecords(context.db, message.runId);
  if (found === null) return;
  const { run } = found;
  if (hasPendingCancelRequest(context.db, run.id)) {
    finish(context, message, "state-changed");
    return;
  }
  if (run.state === "queued" || run.state === "ended") {
    finish(context, message, "state-changed");
    return;
  }
  if (agentMessageStep(run.state) === "hold") return;
  const control = getRunControlRequest(context.db, run.id);
  if (control?.status === "pending" && control.control === "pause") return;
  const stored = findRunner(context.db, run.runnerId);
  if (stored === undefined) {
    finish(context, message, "runner-error");
    return;
  }
  let runner: ReturnType<TickContext["adapters"]["runner"]>;
  let mailbox: MailboxRef;
  try {
    runner = context.adapters.runner(stored);
    mailbox = await mailboxFor(context, stored, runner);
  } catch (error) {
    context.logger.warn("agent_message.send_failed", { runId: run.id, error });
    finish(context, message, failureOf(runnerErrorDetail(error)));
    return;
  }
  const onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
  try {
    const progress = await runner.pollRun(onRunner);
    if (progress.kind !== "active") {
      finish(context, message, "state-changed");
      return;
    }
  } catch (error) {
    context.logger.warn("agent_message.send_failed", { runId: run.id, error });
    finish(context, message, failureOf(runnerErrorDetail(error)));
    return;
  }
  const marked = tryWrite(context, run.id, () =>
    markAgentMessageSending(context.db, message.id, context.now()),
  );
  if (marked !== true) return;
  try {
    await runner.sendToAgent(onRunner, { body: message.body });
  } catch (error) {
    context.logger.warn("agent_message.send_failed", { runId: run.id, error });
    const detail = runnerErrorDetail(error);
    if (detail?.kind === "mailbox-missing") {
      context.mailboxes.delete(stored.id);
      tryWrite(context, run.id, () => setRunnerMailbox(context.db, stored.id, null));
    }
    finish(context, message, failureAfterSendStarted(detail));
    return;
  }
  finish(context, message, null);
}

function failureAfterSendStarted(detail: RunnerErrorDetail | null): AgentMessageFailure {
  if (detail === null || detail.kind === "unreachable" || detail.kind === "malformed-output") {
    return "outcome-unknown";
  }
  if (detail.kind === "runner-error" && detail.code === AGENT_ALREADY_FINISHED) {
    return "state-changed";
  }
  return failureOf(detail);
}

function finish(
  context: TickContext,
  message: PendingAgentMessage,
  error: AgentMessageFailure | null,
): void {
  tryWrite(context, message.runId, () =>
    completeAgentMessage(context.db, {
      id: message.id,
      runId: message.runId,
      completedAt: context.now(),
      error,
    }),
  );
}
