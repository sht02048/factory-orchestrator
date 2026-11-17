import type {
  AgentId,
  RunId,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerProjectId,
  WorktreeRef,
} from "./ids.js";

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

/** 트래커 연결과 묶은 티켓. 티켓 키는 트래커 연결 하나 안에서만 유일하다. */
export interface TicketRef {
  connection: TrackerConnectionId;
  key: TicketKey;
}

export function sameTicket(a: TicketRef, b: TicketRef): boolean {
  return a.connection === b.connection && a.key === b.key;
}

interface RunBase {
  id: RunId;
  ticket: TicketRef;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  /** 오케스트레이터가 정한 브랜치(Q40) */
  branch: string;
  /** 대기열 순서이기도 하다(Q73) */
  assignedAt: Date;
}

/**
 * 런 하나. 상태에 따라 갖는 값이 다르다.
 * - Queued: 러너를 정하지 못했거나 비웠으면 runnerId가 null이다(Q65·Q72). 아직 시작하지 않았다.
 * - Running·Waiting for Input·Disconnected: 러너와 워크트리가 있다.
 * - Ended: 에이전트 결과와 PR 상태 두 축이 붙는다. 요약 결과는 붙이지 않고 summarizeRunOutcome으로 계산한다.
 */
export type Run =
  | (RunBase & { state: "queued"; runnerId: RunnerId | null })
  | (RunBase & {
      state: "running" | "waiting-for-input" | "disconnected";
      runnerId: RunnerId;
      worktree: WorktreeRef;
      startedAt: Date;
    })
  | (RunBase & {
      state: "ended";
      runnerId: RunnerId;
      worktree: WorktreeRef;
      startedAt: Date;
      endedAt: Date;
      agentResult: AgentResult;
      prState: PrState;
    });
