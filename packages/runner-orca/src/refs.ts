import { toAgentRef, toMailboxRef } from "@factory/core";
import type { AgentRef, MailboxRef } from "@factory/core";
import { z } from "zod";

/**
 * core가 뜻을 해석하지 않는 MailboxRef·AgentRef에 이 어댑터가 담는 값. Orca의 개념(터미널 핸들,
 * 오케스트레이션 Run·Task·Dispatch)은 이 패키지 안에만 둔다(ADR 0008).
 */

/** 우편함: 우편함 터미널 핸들과 그 터미널이 코디네이터로 묶인 오케스트레이션 Run(Q82.1·Q82.7) */
export interface OrcaMailbox {
  terminal: string;
  runId: string;
}

/** 런의 에이전트: worker-start 결과의 식별자 묶음(research 0008 1절) */
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

/** 이 어댑터가 만든 값이 아니면 null */
export function decodeMailbox(ref: MailboxRef): OrcaMailbox | null {
  const parsed = mailboxSchema.safeParse(parseJson(ref));
  return parsed.success ? { terminal: parsed.data.terminal, runId: parsed.data.run } : null;
}

export function encodeAgent(agent: OrcaAgent): AgentRef {
  return toAgentRef(
    JSON.stringify({ v: 1, dispatch: agent.dispatchId, task: agent.taskId, run: agent.runId }),
  );
}

/** 이 어댑터가 만든 값이 아니면 null */
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
