import { toAgentRef, toMailboxRef } from "@ganger/core";
import type { AgentRef, MailboxRef } from "@ganger/core";
import { z } from "zod";

export interface OrcaMailbox {
  terminal: string;
  runId: string;
}

export interface OrcaAgent {
  dispatchId: string;
  taskId: string;
  runId: string;
}

const mailboxSchema = z.object({
  v: z.literal(1),
  terminal: z.string().min(1),
  run: z.string().min(1),
});
const agentSchema = z.object({
  v: z.literal(1),
  dispatch: z.string().min(1),
  task: z.string().min(1),
  run: z.string().min(1),
});

export function encodeMailbox(mailbox: OrcaMailbox): MailboxRef {
  return toMailboxRef(JSON.stringify({ v: 1, terminal: mailbox.terminal, run: mailbox.runId }));
}

export function decodeMailbox(ref: MailboxRef): OrcaMailbox | null {
  const parsed = mailboxSchema.safeParse(parseJson(ref));
  return parsed.success ? { terminal: parsed.data.terminal, runId: parsed.data.run } : null;
}

export function encodeAgent(agent: OrcaAgent): AgentRef {
  return toAgentRef(
    JSON.stringify({ v: 1, dispatch: agent.dispatchId, task: agent.taskId, run: agent.runId }),
  );
}

export function decodeAgent(ref: AgentRef): OrcaAgent | null {
  const parsed = agentSchema.safeParse(parseJson(ref));
  return parsed.success
    ? { dispatchId: parsed.data.dispatch, taskId: parsed.data.task, runId: parsed.data.run }
    : null;
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}
