import { AGENT_MESSAGE_MAX_LENGTH, toRunId } from "@ganger/core";
import { requestAgentMessage, requestRunCancel, requestWorktreeRemoval } from "@ganger/db";
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

export const agentMessageInput = z.object({
  runId: z.string().min(1),
  body: z.string().trim().min(1).max(AGENT_MESSAGE_MAX_LENGTH),
});

export function sendAgentMessageRequest(
  db: Database,
  input: z.infer<typeof agentMessageInput>,
  now: Date,
): RunActionResult {
  const result = requestAgentMessage(db, toRunId(input.runId), input.body, now);
  return result.ok ? { ok: true } : result;
}
