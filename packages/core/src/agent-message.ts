import type { RunState } from "./run.js";
import { RUN_CONTROL_FAILURES } from "./transition.js";

export const AGENT_MESSAGE_MAX_LENGTH = 4_000;
export const AGENT_ALREADY_FINISHED = "agent_already_finished";

export const AGENT_MESSAGE_FAILURES = [...RUN_CONTROL_FAILURES, "outcome-unknown"] as const;
export type AgentMessageFailure = (typeof AGENT_MESSAGE_FAILURES)[number];

export function isAgentMessageFailure(value: string | null): value is AgentMessageFailure {
  return AGENT_MESSAGE_FAILURES.some((failure) => failure === value);
}

export function acceptsAgentMessage(state: RunState): boolean {
  return state === "running" || state === "waiting-for-input" || state === "paused";
}

export type AgentMessageStep = "send" | "hold" | "reject";

export function agentMessageStep(state: RunState): AgentMessageStep {
  switch (state) {
    case "running":
    case "waiting-for-input":
      return "send";
    case "paused":
    case "disconnected":
      return "hold";
    case "queued":
    case "ended":
      return "reject";
  }
}
