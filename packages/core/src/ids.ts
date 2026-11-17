/**
 * 뜻이 다른 문자열 ID를 서로 바꿔 넘기지 못하게 하는 branded type
 * (CODING_STANDARDS 「ID는 branded type으로 쓴다」).
 *
 * 값은 아래 `to*` 함수로만 만든다. 함수는 빈 문자열을 거부하는 타입 가드를 거쳐
 * `as` 단언 없이 brand를 붙인다.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** 트래커의 티켓 키. 예: "ENG-123" */
export type TicketKey = Brand<string, "TicketKey">;
/** 오케스트레이터가 등록한 러너 하나의 ID */
export type RunnerId = Brand<string, "RunnerId">;
/** 러너 쪽 프로젝트 ID. Orca projectId, 예: "github:acme/app" */
export type RunnerProjectId = Brand<string, "RunnerProjectId">;
/** Orca 워크트리 ID "<repoId>::<path>" (`worktree ps`의 worktreeId와 같은 값) */
export type WorktreeRef = Brand<string, "WorktreeRef">;
/** 오케스트레이터가 만든 런 하나의 ID */
export type RunId = Brand<string, "RunId">;

function isNonEmpty<B extends string>(value: string): value is Brand<string, B> {
  return value.length > 0;
}

function brand<B extends string>(kind: B, value: string): Brand<string, B> {
  if (!isNonEmpty<B>(value)) {
    throw new TypeError(`${kind}는 빈 문자열일 수 없다`);
  }
  return value;
}

export function toTicketKey(value: string): TicketKey {
  return brand("TicketKey", value);
}

export function toRunnerId(value: string): RunnerId {
  return brand("RunnerId", value);
}

export function toRunnerProjectId(value: string): RunnerProjectId {
  return brand("RunnerProjectId", value);
}

export function toWorktreeRef(value: string): WorktreeRef {
  return brand("WorktreeRef", value);
}

export function toRunId(value: string): RunId {
  return brand("RunId", value);
}
