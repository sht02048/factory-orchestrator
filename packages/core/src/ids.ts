export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TrackerKind = Brand<string, "TrackerKind">;
export type RunnerKind = Brand<string, "RunnerKind">;
export type CodeHostKind = Brand<string, "CodeHostKind">;

export type TrackerConnectionId = Brand<string, "TrackerConnectionId">;
export type TicketKey = Brand<string, "TicketKey">;
export type TrackerProjectId = Brand<string, "TrackerProjectId">;
export type LabelId = Brand<string, "LabelId">;
export type TrackerStateId = Brand<string, "TrackerStateId">;
export type CommentId = Brand<string, "CommentId">;
export type DeliveryId = Brand<string, "DeliveryId">;

export type RunnerId = Brand<string, "RunnerId">;
export type RunnerProjectId = Brand<string, "RunnerProjectId">;
export type WorktreeRef = Brand<string, "WorktreeRef">;
export type RunId = Brand<string, "RunId">;
export type AgentMessageRequestId = Brand<string, "AgentMessageRequestId">;
export type RunActionRequestId = Brand<string, "RunActionRequestId">;
export type FollowUpRef = Brand<string, "FollowUpRef">;
export type AgentId = Brand<string, "AgentId">;
export type AgentRef = Brand<string, "AgentRef">;
export type MailboxRef = Brand<string, "MailboxRef">;
export type QuestionId = Brand<string, "QuestionId">;
export type PermissionRequestId = Brand<string, "PermissionRequestId">;

export type RepoRef = Brand<string, "RepoRef">;
export type PullRequestId = Brand<string, "PullRequestId">;

function isNonEmpty<B extends string>(value: string): value is Brand<string, B> {
  return value.length > 0;
}

function brand<B extends string>(kind: B, value: string): Brand<string, B> {
  if (!isNonEmpty<B>(value)) {
    throw new TypeError(`${kind}는 빈 문자열일 수 없다`);
  }
  return value;
}

export const toTrackerKind = (value: string): TrackerKind => brand("TrackerKind", value);
export const toRunnerKind = (value: string): RunnerKind => brand("RunnerKind", value);
export const toCodeHostKind = (value: string): CodeHostKind => brand("CodeHostKind", value);
export const toTrackerConnectionId = (value: string): TrackerConnectionId =>
  brand("TrackerConnectionId", value);
export const toCommentId = (value: string): CommentId => brand("CommentId", value);
export const toDeliveryId = (value: string): DeliveryId => brand("DeliveryId", value);
export const toAgentId = (value: string): AgentId => brand("AgentId", value);
export const toAgentRef = (value: string): AgentRef => brand("AgentRef", value);
export const toMailboxRef = (value: string): MailboxRef => brand("MailboxRef", value);
export const toQuestionId = (value: string): QuestionId => brand("QuestionId", value);
export const toPermissionRequestId = (value: string): PermissionRequestId =>
  brand("PermissionRequestId", value);
export const toPullRequestId = (value: string): PullRequestId => brand("PullRequestId", value);
export const toTicketKey = (value: string): TicketKey => brand("TicketKey", value);
export const toTrackerProjectId = (value: string): TrackerProjectId =>
  brand("TrackerProjectId", value);
export const toLabelId = (value: string): LabelId => brand("LabelId", value);
export const toTrackerStateId = (value: string): TrackerStateId => brand("TrackerStateId", value);
export const toRunnerId = (value: string): RunnerId => brand("RunnerId", value);
export const toRunnerProjectId = (value: string): RunnerProjectId =>
  brand("RunnerProjectId", value);
export const toWorktreeRef = (value: string): WorktreeRef => brand("WorktreeRef", value);
export const toRunId = (value: string): RunId => brand("RunId", value);
export const toFollowUpRef = (value: string): FollowUpRef => brand("FollowUpRef", value);
export const toAgentMessageRequestId = (value: string): AgentMessageRequestId =>
  brand("AgentMessageRequestId", value);
export const toRunActionRequestId = (value: string): RunActionRequestId =>
  brand("RunActionRequestId", value);
export const toRepoRef = (value: string): RepoRef => brand("RepoRef", value);
