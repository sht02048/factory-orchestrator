export const WORKSPACE_BRIEF_MAX_LENGTH = 8_000;

export interface WorkspaceBrief {
  before: string;
  after: string;
}

export const EMPTY_WORKSPACE_BRIEF: WorkspaceBrief = { before: "", after: "" };

export const CONTINUE_MESSAGE_MAX_LENGTH = 8_000;

export type AgentBriefPartKind = "before" | "ticket" | "after" | "protocol";

export interface AgentBriefPart {
  kind: AgentBriefPartKind;
  text: string;
}

export interface AgentBriefInput {
  workspace: WorkspaceBrief;
  ticket: string;
  protocol: string;
}

export interface ContinuationBriefInput extends AgentBriefInput {
  operatorMessage: string;
  previousReport: string | null;
}

export function ticketBriefText(ticket: { title: string; body: string }): string {
  return `${ticket.title}\n\n${ticket.body}`;
}

export function workspaceBriefLength(text: string): number {
  return Array.from(text).length;
}

export function agentBriefParts(input: AgentBriefInput): AgentBriefPart[] {
  const parts: AgentBriefPart[] = [
    { kind: "before", text: input.workspace.before },
    { kind: "ticket", text: input.ticket },
    { kind: "after", text: input.workspace.after },
    { kind: "protocol", text: input.protocol },
  ];
  return parts
    .map((part) => ({ kind: part.kind, text: part.text.trim() }))
    .filter((part) => part.text !== "");
}

export function joinAgentBrief(parts: ReadonlyArray<AgentBriefPart>): string {
  return `${parts.map((part) => part.text).join("\n\n")}\n`;
}

export function composeAgentBrief(input: AgentBriefInput): string {
  return joinAgentBrief(agentBriefParts(input));
}

export function composeContinuationBrief(input: ContinuationBriefInput): string {
  const report = input.previousReport?.trim() ?? "";
  const lead = [
    `## 운영자의 말\n\n${input.operatorMessage.trim()}`,
    ...(report === "" ? [] : [`## 이전 런의 완료 보고\n\n${report}`]),
  ];
  return `${[...lead, ...agentBriefParts(input).map((part) => part.text)].join("\n\n")}\n`;
}
