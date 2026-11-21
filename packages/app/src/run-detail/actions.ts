import { AGENT_MESSAGE_MAX_LENGTH, toAgentMessageRequestId, toRunId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  continueRun,
  requestAgentMessage,
  requestPreviousAgentStop,
  requestRunCancel,
  requestWorktreeRemoval,
  skipBlockerWait,
} from "@ganger/db";
import type { ContinueRunBlock } from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";

export type RunActionResult = { ok: true } | { ok: false; reason: string };

export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}

export function removeWorktreeRequest(db: Database, runId: string, now: Date): RunActionResult {
  return requestWorktreeRemoval(db, toRunId(runId), now);
}

export type ContinueRunActionResult =
  | { ok: true; runId: RunId }
  | { ok: false; reason: ContinueRunBlock };

export function continueRunRequest(
  db: Database,
  runId: RunId,
  message: string,
  now: Date,
): ContinueRunActionResult {
  const result = continueRun(db, { from: runId, message, now });
  return result.ok ? { ok: true, runId: result.run.id } : result;
}

export function stopPreviousAgentRequest(db: Database, runId: RunId, now: Date): RunActionResult {
  return requestPreviousAgentStop(db, runId, now);
}

export const agentMessageInput = z.object({
  runId: z.string().min(1),
  requestId: z.string().min(16).max(64),
  body: z
    .string()
    .trim()
    .min(1)
    .max(AGENT_MESSAGE_MAX_LENGTH)
    .refine((body) => !body.includes("\0")),
});

export const skipBlockerWaitInput = z.object({
  runId: z.string().min(1),
  requestId: z.string().min(16).max(64),
});

export function skipBlockerWaitRequest(
  db: Database,
  input: z.infer<typeof skipBlockerWaitInput>,
  now: Date,
): RunActionResult {
  return skipBlockerWait(db, toRunId(input.runId), input.requestId, now);
}

export function sendAgentMessageRequest(
  db: Database,
  input: z.infer<typeof agentMessageInput>,
  now: Date,
): RunActionResult {
  const result = requestAgentMessage(
    db,
    toRunId(input.runId),
    { requestId: toAgentMessageRequestId(input.requestId), body: input.body },
    now,
  );
  return result.ok ? { ok: true } : result;
}
