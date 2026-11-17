/*
 * Runners 화면이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값만 담는다. 문구는 메시지 파일이 정한다.
 * 러너는 Workspace 밖 자원이라 이 값은 현재 Workspace 와 상관없다(ADR 0006).
 */

/** 런이 속한 Workspace. 런 목록(Runs)으로 가는 링크에 쓴다 */
export interface RunWorkspace {
  id: string;
  name: string;
}

/** capacity 를 차지하는 런(Running, Waiting for Input, Disconnected, Q74) */
export interface OccupyingRun {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  state: "running" | "waiting-for-input" | "disconnected";
  /** 시작부터 지금까지 */
  executionMs: number;
}

/** 이 러너로 정한 Queued 런 */
export interface QueuedRunView {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  /** 할당부터 지금까지 */
  waitMs: number;
}

/**
 * 러너에 남은 워크트리. 요약 계산 함수(core summarizeRunOutcome)의 워크트리 처리가 아래 둘이고
 * 아직 지운 시각이 없는 Ended 런이다(Q44·Q51·Q75·Q77).
 * - keep-until-pr-settles: PR 이 병합되거나 닫힐 때까지 남김
 * - operator-decides: 자동으로 지우지 않음, 사람이 정함
 */
export interface LeftWorktree {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  worktree: "keep-until-pr-settles" | "operator-decides";
}

/**
 * 러너 쪽 GitHub 인증 확인 하나(core RunnerPrerequisite 중 할당을 막는 것, Q82.14·Q82.15). 1단계는
 * 프로젝트 저장소마다 `git push --dry-run`이라 이름이 그 프로젝트를 가리킨다.
 */
export interface GitHubAuthCheck {
  id: string;
  name: string;
  /** 통과하면 true, 깨졌으면 false, 확인하지 못했으면 null */
  satisfied: boolean | null;
  /** 러너 어댑터가 준 해결 방법. 없으면 null */
  hint: string | null;
}

export interface RunnerView {
  id: string;
  name: string;
  online: boolean;
  /** GitHub 인증이 깨져 할당에서 빠졌는지(Q82.14). Online/Offline 은 바꾸지 않는다 */
  assignmentBlocked: boolean;
  /** 마지막으로 읽은 GitHub 인증 결과. 아직 읽지 못했으면 null */
  githubAuth: GitHubAuthCheck[] | null;
  /** 마지막 상태 확인부터 지금까지. 확인한 적 없으면 null */
  checkedAgoMs: number | null;
  capacity: number;
  /** 시작한 순서. 모든 Workspace 의 런이다 */
  occupying: OccupyingRun[];
  /** 대기열 순서. 모든 Workspace 의 런이다 */
  queued: QueuedRunView[];
  /** 할당 순서 */
  leftWorktrees: LeftWorktree[];
  /** 러너 쪽 프로젝트 이름 */
  projects: string[];
  /** 러너 설정의 ssh 대상. 설정에 없으면 null */
  sshTarget: string | null;
  /** 러너 설정의 orca 실행 파일 경로. 설정에 없으면 null */
  orcaPath: string | null;
}

export interface RunnersPage {
  /** 등록한 순서 */
  runners: RunnerView[];
}
