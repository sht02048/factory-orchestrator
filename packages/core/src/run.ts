import type {
  AgentId,
  AgentRef,
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
 * 에이전트 결과 아홉(GLOSSARY 「에이전트 결과」, 스펙 4.2). 종료 코드는 쓰지 않는다(Q82.2).
 * - reported-success: 완료 보고(성공). outcome 성공인 완료 보고를 보냈다
 * - reported-failure: 완료 보고(실패). outcome 실패인 완료 보고를 보냈다
 * - ended-without-report: 비정상 종료. 완료 보고 없이 에이전트가 사라졌다(Q82.19)
 * - timed-out: 시간 초과(Running 중 최대 실행 시간 초과)
 * - stopped-waiting-for-input: 입력 기다리다 멈춤(Waiting for Input 중 초과)
 * - runner-disconnected: 러너 연결 끊김(Disconnected인 채 초과)
 * - worktree-missing: 워크트리 없음
 * - canceled: 운영자가 취소함(Q77·Q82.8)
 * - could-not-start: 시작할 수 없음(Q82.16·Q86)
 */
export const AGENT_RESULTS = [
  "reported-success",
  "reported-failure",
  "ended-without-report",
  "timed-out",
  "stopped-waiting-for-input",
  "runner-disconnected",
  "worktree-missing",
  "canceled",
  "could-not-start",
] as const;
export type AgentResult = (typeof AGENT_RESULTS)[number];

/**
 * 시작하지 않고 끝날 수 있는 에이전트 결과. Queued에서 취소했거나(Q82.10) 시작할 수 없어 끝낸
 * 런(Q82.16·Q82.20)이다. 이런 런은 워크트리와 시작 시각이 없고 PR 상태가 늘 없음이다.
 */
export const NOT_STARTED_AGENT_RESULTS = ["canceled", "could-not-start"] as const;
export type NotStartedAgentResult = (typeof NOT_STARTED_AGENT_RESULTS)[number];

/** PR 상태 넷: 없음, 열림, 병합됨, 닫힘(병합 없이) */
export const PR_STATES = ["none", "open", "merged", "closed"] as const;
export type PrState = (typeof PR_STATES)[number];

/** 요약 결과 넷. 저장하지 않고 summarizeRunOutcome으로만 계산한다. */
export const SUMMARY_OUTCOMES = ["merged", "human-check", "failed", "canceled"] as const;
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
  /**
   * 에이전트 모델. 할당 때 Mapping 에서 옮겨 적는다(0043). null 이면 정하지 않은 것이라 러너 설정의 모델을,
   * 그것도 없으면 러너 도구의 기본값을 쓴다.
   */
  model: string | null;
  /**
   * 오케스트레이터가 할당 때 정하는 결정적 워크트리 이름. 시작 전에 저장하고 시작 멱등 키로 쓴다
   * (Runner.findStartedRun). 브랜치는 러너가 정하므로 멱등 키가 아니다(Q82.6).
   */
  worktreeName: string;
  /** 대기열 순서이기도 하다(Q73) */
  assignedAt: Date;
}

/** 러너에서 시작한 런이 갖는 값 */
interface StartedRunFields {
  runnerId: RunnerId;
  worktree: WorktreeRef;
  /** 러너에서 받은 실제 브랜치 이름. PR 찾기 1순위다(Q82.6) */
  branch: string;
  /** 러너 안에서 이 런의 에이전트를 가리키는 값 */
  agentRef: AgentRef;
  startedAt: Date;
}

/**
 * 요약 결과와 워크트리 처리를 정하는 입력(스펙 4.2). Ended 런이 그대로 이 모양을 가진다.
 * `runnerUnreached`는 운영자가 취소함으로 끝난 런이 러너에 닿지 못한 채 끝났는지다(Q82.21).
 * 시작한 뒤 취소한 런이 다시 닿지 못한 채 최대 실행 시간이 지나 끝난 경우만 참이고, 그 밖은 늘 거짓이다.
 */
export interface RunAxes {
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
}

/** Ended 런 가운데 러너에서 시작한 런 */
export type StartedEndedRun = RunBase &
  StartedRunFields &
  RunAxes & {
    state: "ended";
    endedAt: Date;
  };

/**
 * Ended 런 가운데 시작하지 않고 끝난 런(Queued에서 취소, 시작할 수 없음). 워크트리·브랜치·시작 시각이
 * 없고 PR 상태가 없음으로 고정된다(Q82.10·Q82.20). 러너는 Queued 때 정한 것이 있으면 남는다.
 */
export type NotStartedEndedRun = RunBase & {
  state: "ended";
  runnerId: RunnerId | null;
  worktree: null;
  branch: null;
  agentRef: null;
  startedAt: null;
  endedAt: Date;
  agentResult: NotStartedAgentResult;
  prState: "none";
  runnerUnreached: false;
};

export type EndedRun = StartedEndedRun | NotStartedEndedRun;

/**
 * 런 하나. 상태에 따라 갖는 값이 다르다.
 * - Queued: 러너를 정하지 못했거나 비웠으면 runnerId가 null이다(Q65·Q72·Q78·Q82.22). 아직 시작하지 않았다.
 * - Running·Waiting for Input·Disconnected: 러너, 워크트리, 실제 브랜치, 에이전트 참조가 있다.
 * - Ended: 에이전트 결과와 PR 상태 두 축이 붙는다. 요약 결과는 붙이지 않고 summarizeRunOutcome으로 계산한다.
 *   시작하지 않고 끝난 런은 NotStartedEndedRun이다.
 * 취소 중(처리되지 않은 취소 요청이 있음)은 런 상태가 아니라 DB의 요청으로 안다(Q82.21).
 */
export type Run =
  | (RunBase & { state: "queued"; runnerId: RunnerId | null })
  | (RunBase &
      StartedRunFields & {
        state: "running" | "waiting-for-input" | "disconnected";
      })
  | EndedRun;
