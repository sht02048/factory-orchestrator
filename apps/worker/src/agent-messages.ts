import { withLogContext } from "@ganger/log";
import { agentMessageStep } from "@ganger/core";
import type {
  AgentMessageFailure,
  FollowUpRef,
  MailboxRef,
  RunId,
  RunnerErrorDetail,
} from "@ganger/core";
import {
  completeAgentMessage,
  getRunControlRequest,
  getRunWithRecords,
  hasPendingCancelRequest,
  isAgentMessagePending,
  listPendingAgentMessages,
  markAgentMessageSending,
  recordAgentMessageFollowUp,
  setRunnerMailbox,
} from "@ganger/db";
import type { PendingAgentMessage } from "@ganger/db";
import { findRunner, mailboxFor, runnerErrorDetail, tryWrite } from "./context.js";
import type { TickContext } from "./context.js";
import { failureOf } from "./control.js";

export const FOLLOW_UP_STOP_RETRY_MS = 60 * 60_000;

type WorkerRunner = ReturnType<TickContext["adapters"]["runner"]>;
type StoredRunner = NonNullable<ReturnType<typeof findRunner>>;

export async function processAgentMessages(context: TickContext): Promise<void> {
  let pending: PendingAgentMessage[];
  try {
    pending = listPendingAgentMessages(context.db);
  } catch (error) {
    context.logger.warn("agent_message.read_failed", { error });
    return;
  }
  const runsWaiting = new Set<RunId>();
  for (const message of pending) {
    if (runsWaiting.has(message.runId)) continue;
    try {
      await withLogContext({ runId: message.runId }, () => deliver(context, message));
      if (isAgentMessagePending(context.db, message.id)) runsWaiting.add(message.runId);
    } catch (error) {
      runsWaiting.add(message.runId);
      context.logger.warn("agent_message.read_failed", { runId: message.runId, error });
    }
  }
}

async function deliver(context: TickContext, message: PendingAgentMessage): Promise<void> {
  if (message.followUpRef !== null) {
    const startedAt = message.sendStartedAt?.getTime() ?? 0;
    const canRetry = context.now().getTime() - startedAt < FOLLOW_UP_STOP_RETRY_MS;
    await stopFollowUp(context, message, message.followUpRef, canRetry);
    return;
  }
  if (message.sendStartedAt !== null) {
    finish(context, message, "outcome-unknown");
    return;
  }
  const blocked = sendBlock(context, message);
  if (blocked !== "clear") {
    if (blocked !== "hold") finish(context, message, blocked);
    return;
  }
  const found = getRunWithRecords(context.db, message.runId);
  if (found === null) return;
  const { run } = found;
  if (run.state === "queued" || run.state === "ended") return;
  const stored = findRunner(context.db, run.runnerId);
  if (stored === undefined) {
    finish(context, message, "runner-error");
    return;
  }
  let runner: WorkerRunner;
  let mailbox: MailboxRef;
  try {
    runner = context.adapters.runner(stored);
    mailbox = await mailboxFor(context, stored, runner);
    const progress = await runner.pollRun({
      mailbox,
      worktree: run.worktree,
      agentRef: run.agentRef,
    });
    if (progress.kind !== "active") {
      finish(context, message, "state-changed");
      return;
    }
  } catch (error) {
    context.logger.warn("agent_message.send_failed", { runId: run.id, error });
    const detail = runnerErrorDetail(error);
    forgetMissingMailbox(context, message, stored, detail);
    if (!retriableBeforeSend(detail) && detail?.kind !== "mailbox-missing") {
      finish(context, message, failureOf(detail));
    }
    return;
  }
  const recheck = sendBlock(context, message);
  if (recheck !== "clear") {
    if (recheck !== "hold") finish(context, message, recheck);
    return;
  }
  const marked = tryWrite(context, run.id, () =>
    markAgentMessageSending(context.db, message.id, context.now()),
  );
  if (marked !== true) return;
  let sent: Awaited<ReturnType<WorkerRunner["sendToAgent"]>>;
  try {
    sent = await runner.sendToAgent(
      { mailbox, worktree: run.worktree, agentRef: run.agentRef },
      { body: message.body },
    );
  } catch (error) {
    context.logger.warn("agent_message.send_failed", { runId: run.id, error });
    const detail = runnerErrorDetail(error);
    forgetMissingMailbox(context, message, stored, detail);
    finish(context, message, failureAfterSendStarted(detail));
    return;
  }
  if (sent.kind === "delivered") {
    finish(context, message, null);
    return;
  }
  const { followUpRef } = sent;
  const remembered = tryWrite(context, run.id, () =>
    recordAgentMessageFollowUp(context.db, message.id, followUpRef),
  );
  await stopFollowUp(context, message, followUpRef, remembered === true);
}

function sendBlock(
  context: TickContext,
  message: PendingAgentMessage,
): "clear" | "hold" | "state-changed" {
  const found = getRunWithRecords(context.db, message.runId);
  if (found === null) return "hold";
  const { run } = found;
  if (hasPendingCancelRequest(context.db, run.id)) return "state-changed";
  if (run.state === "queued" || run.state === "ended") return "state-changed";
  if (agentMessageStep(run.state) === "hold") return "hold";
  const control = getRunControlRequest(context.db, run.id);
  return control?.status === "pending" && control.control === "pause" ? "hold" : "clear";
}

async function stopFollowUp(
  context: TickContext,
  message: PendingAgentMessage,
  followUpRef: FollowUpRef,
  canRetry: boolean,
): Promise<void> {
  const found = getRunWithRecords(context.db, message.runId);
  const runnerId = found?.run.runnerId ?? null;
  const stored = runnerId === null ? undefined : findRunner(context.db, runnerId);
  if (stored === undefined) {
    context.logger.warn("agent_message.follow_up_not_stopped", {
      runId: message.runId,
      followUpRef,
    });
    finish(context, message, "follow-up-not-stopped");
    return;
  }
  try {
    await context.adapters.runner(stored).stopFollowUp(followUpRef);
  } catch (error) {
    context.logger.warn("agent_message.follow_up_not_stopped", {
      runId: message.runId,
      followUpRef,
      error,
    });
    const detail = runnerErrorDetail(error);
    if (!canRetry || !retriableBeforeSend(detail)) {
      finish(context, message, "follow-up-not-stopped");
    }
    return;
  }
  finish(context, message, "follow-up-stopped");
}

function retriableBeforeSend(detail: RunnerErrorDetail | null): boolean {
  return detail?.kind === "unreachable" || detail?.kind === "not-ready";
}

function forgetMissingMailbox(
  context: TickContext,
  message: PendingAgentMessage,
  stored: StoredRunner,
  detail: RunnerErrorDetail | null,
): void {
  if (detail?.kind !== "mailbox-missing") return;
  context.mailboxes.delete(stored.id);
  tryWrite(context, message.runId, () => setRunnerMailbox(context.db, stored.id, null));
}

function failureAfterSendStarted(detail: RunnerErrorDetail | null): AgentMessageFailure {
  if (
    detail === null ||
    detail.kind === "unreachable" ||
    detail.kind === "malformed-output" ||
    detail.kind === "start-outcome-unknown"
  ) {
    return "outcome-unknown";
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
