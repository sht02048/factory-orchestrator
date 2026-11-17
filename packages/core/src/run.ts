/**
 * 런의 상태와 두 축(에이전트 결과, PR 상태), 요약 결과.
 * 이름과 뜻은 GLOSSARY, 표는 스펙 4.1·4.2를 따른다.
 */

/** Run 상태 다섯. 화면 문구는 메시지 파일이 정한다. */
export const RUN_STATES = [
  "queued",
  "running",
  "waiting-for-input",
  "disconnected",
  "ended",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** 티켓당 하나만 있을 수 있고 할당을 막는 상태(Q45·Q74). Ended만 빠진다. */
export const ACTIVE_RUN_STATES: ReadonlySet<RunState> = new Set([
  "queued",
  "running",
  "waiting-for-input",
  "disconnected",
]);

/** 러너의 capacity를 차지하는 상태. Disconnected도 차지한다(Q74). */
export const CAPACITY_OCCUPYING_STATES: ReadonlySet<RunState> = new Set([
  "running",
  "waiting-for-input",
  "disconnected",
]);

/**
 * 에이전트 결과 여섯(GLOSSARY 「에이전트 결과」).
 * - exited-normally: 정상 종료(종료 코드 0)
 * - exited-with-error: 오류 종료(0이 아닌 종료 코드)
 * - timed-out: 시간 초과(Running 중 최대 실행 시간 초과)
 * - stopped-waiting-for-input: 입력 기다리다 멈춤(Waiting for Input 중 초과)
 * - runner-disconnected: 러너 연결 끊김(Disconnected인 채 초과)
 * - worktree-missing: 워크트리 없음
 */
export const AGENT_RESULTS = [
  "exited-normally",
  "exited-with-error",
  "timed-out",
  "stopped-waiting-for-input",
  "runner-disconnected",
  "worktree-missing",
] as const;
export type AgentResult = (typeof AGENT_RESULTS)[number];

/** PR 상태 넷: 없음, 열림, 병합됨, 닫힘(병합 없이) */
export const PR_STATES = ["none", "open", "merged", "closed"] as const;
export type PrState = (typeof PR_STATES)[number];

/** 요약 결과 셋. 저장하지 않고 summarizeRunOutcome으로만 계산한다. */
export const SUMMARY_OUTCOMES = ["merged", "human-check", "failed"] as const;
export type SummaryOutcome = (typeof SUMMARY_OUTCOMES)[number];

/**
 * 워크트리 처리 넷(스펙 4.2 표의 「워크트리」 칸).
 * - remove-now: 바로 지움
 * - keep-until-pr-settles: PR이 병합되거나 닫힐 때까지 남김
 * - operator-decides: 자동으로 지우지 않음, 러너가 돌아온 뒤 사람이 정함
 * - nothing-to-remove: 지울 것이 없음
 */
export const WORKTREE_DISPOSITIONS = [
  "remove-now",
  "keep-until-pr-settles",
  "operator-decides",
  "nothing-to-remove",
] as const;
export type WorktreeDisposition = (typeof WORKTREE_DISPOSITIONS)[number];
