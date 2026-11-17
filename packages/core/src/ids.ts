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

/** 트래커의 티켓 키. 사람이 읽는 값, 예: "ENG-123" */
export type TicketKey = Brand<string, "TicketKey">;
/** 트래커 프로젝트 ID */
export type TrackerProjectId = Brand<string, "TrackerProjectId">;
/** 트래커 라벨 ID */
export type LabelId = Brand<string, "LabelId">;
/** 트래커 상태(워크플로 상태) ID */
export type TrackerStateId = Brand<string, "TrackerStateId">;

/** 오케스트레이터가 등록한 러너 하나의 ID */
export type RunnerId = Brand<string, "RunnerId">;
/** 러너 쪽 프로젝트 ID. 러너 어댑터가 정한다 */
export type RunnerProjectId = Brand<string, "RunnerProjectId">;
/** 러너 안의 워크트리 하나를 가리키는 값. 러너 어댑터가 정한다 */
export type WorktreeRef = Brand<string, "WorktreeRef">;
/** 오케스트레이터가 만든 런 하나의 ID */
export type RunId = Brand<string, "RunId">;

/** 코드 호스트의 저장소 하나. 코드 호스트 어댑터가 정규화한 값이라 문자열 비교로 같은지 본다 */
export type RepoRef = Brand<string, "RepoRef">;

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
