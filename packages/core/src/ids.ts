/**
 * 뜻이 다른 문자열 ID를 서로 바꿔 넘기지 못하게 하는 branded type
 * (CODING_STANDARDS 「ID는 branded type으로 쓴다」).
 *
 * 외부 시스템이 정한 ID는 core에서 뜻을 해석하지 않는 불투명한 문자열이다. 어느 시스템의 값인지는
 * 어댑터 종류(TrackerKind·RunnerKind·CodeHostKind)가 정하고, 같은 값끼리 같은지만 비교한다.
 *
 * 값은 아래 `to*` 함수로만 만든다. 함수는 빈 문자열을 거부하는 타입 가드를 거쳐
 * `as` 단언 없이 brand를 붙인다.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** 트래커 어댑터 종류. 예: "linear" */
export type TrackerKind = Brand<string, "TrackerKind">;
/** 러너 어댑터 종류. 예: "orca" */
export type RunnerKind = Brand<string, "RunnerKind">;
/** 코드 호스트 어댑터 종류. 예: "github" */
export type CodeHostKind = Brand<string, "CodeHostKind">;

/** 오케스트레이터에 등록한 Tracker Connection 하나의 ID */
export type TrackerConnectionId = Brand<string, "TrackerConnectionId">;
/** 트래커의 티켓 키. 사람이 읽는 값, 예: "ENG-123". 트래커 연결 하나 안에서만 유일하다 */
export type TicketKey = Brand<string, "TicketKey">;
/** 트래커 프로젝트 ID */
export type TrackerProjectId = Brand<string, "TrackerProjectId">;
/** 트래커 라벨 ID */
export type LabelId = Brand<string, "LabelId">;
/** 트래커 상태(워크플로 상태) ID */
export type TrackerStateId = Brand<string, "TrackerStateId">;
/** 트래커 댓글 ID */
export type CommentId = Brand<string, "CommentId">;
/** webhook 배달 하나의 중복 제거 키 */
export type DeliveryId = Brand<string, "DeliveryId">;

/** 오케스트레이터가 등록한 러너 하나의 ID */
export type RunnerId = Brand<string, "RunnerId">;
/** 러너 쪽 프로젝트 ID. 러너 어댑터가 정한다 */
export type RunnerProjectId = Brand<string, "RunnerProjectId">;
/** 러너 안의 워크트리 하나를 가리키는 값. 러너 어댑터가 정한다 */
export type WorktreeRef = Brand<string, "WorktreeRef">;
/** 오케스트레이터가 만든 런 하나의 ID */
export type RunId = Brand<string, "RunId">;
/** 러너 도구의 에이전트 ID. 예: "claude", "codex" */
export type AgentId = Brand<string, "AgentId">;
/**
 * 러너 안에서 런 하나의 에이전트를 가리키는 값. 러너 어댑터가 시작할 때 정하고(예: Orca 오케스트레이션의
 * 식별자 묶음) core는 뜻을 해석하지 않는다. 런 레코드에 저장해 진행 폴링·답하기·멈추기에 다시 넘긴다.
 */
export type AgentRef = Brand<string, "AgentRef">;
/**
 * 러너의 우편함 터미널(GLOSSARY Mailbox Terminal)과 그에 묶인 메일함을 가리키는 값. 러너 어댑터가 만들고
 * 정한다(Q82.1·Q82.7). 러너마다 하나이고 오케스트레이터 DB에 둔다.
 */
export type MailboxRef = Brand<string, "MailboxRef">;
/** 에이전트가 보낸 질문 메일 하나. 러너 어댑터가 정한 불투명한 메일 ID다(Q82.3·Q82.5) */
export type QuestionId = Brand<string, "QuestionId">;
/** 에이전트의 권한 대기 하나. 러너 어댑터가 정한 불투명한 값이다(Q82.4) */
export type PermissionRequestId = Brand<string, "PermissionRequestId">;

/** 코드 호스트의 저장소 하나. 코드 호스트 어댑터가 정규화한 값이라 문자열 비교로 같은지 본다 */
export type RepoRef = Brand<string, "RepoRef">;
/** 코드 호스트 안의 PR 하나. 코드 호스트 어댑터가 정하고 core는 뜻을 해석하지 않는다 */
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
export const toRepoRef = (value: string): RepoRef => brand("RepoRef", value);
