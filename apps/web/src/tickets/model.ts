import type { AgentResult, PrState, SummaryOutcome, TrackerStateCategory } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";

/*
 * Tickets 화면이 보이는 값. server function 이 돌려주고 화면이 그린다. DB·어댑터를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값만 담는다. 문구는 메시지 파일이 정한다.
 */

/** 티켓의 런 하나. 마지막 런과 런 이력에 쓴다 */
export type TicketRun =
  | {
      id: string;
      assignedAt: string;
      state: "queued" | "running" | "waiting-for-input" | "disconnected";
    }
  | {
      id: string;
      assignedAt: string;
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      /** core summarizeRunOutcome 으로 계산한 값 */
      summary: SummaryOutcome;
      /** 런이 끝난 뒤 사람이 PR 을 병합하거나 닫았는지(이후 PR 상태). Human Check 를 손댈 일에서 뺀다(Q89) */
      prSettledLater: boolean;
    };

/** Mapping 이 정한 할당 기본값(Q53·Q60). 러너 쪽 프로젝트는 바꿀 수 없다 */
export interface AssignDefaults {
  runnerProject: string;
  agent: string;
}

/**
 * 이 티켓을 지금 할당할 수 있는지.
 * - ready: Mapping 기본값으로 할당 창을 연다
 * - active-run: Queued·Running·Waiting for Input·Disconnected 런이 있다(Q45·Q74)
 * - no-mapping: 트래커 프로젝트에 Mapping 이 없다
 */
export type Assignability =
  | { kind: "ready"; defaults: AssignDefaults }
  | { kind: "active-run"; runId: string }
  | { kind: "no-mapping" };

export interface TicketView {
  /** 화면 안에서 티켓을 가리키는 값(트래커 연결과 티켓 키). 다른 연결의 같은 키는 다른 티켓이다 */
  id: string;
  connection: string;
  key: string;
  title: string;
  /** 트래커의 티켓 주소. http(s) 가 아니면 null */
  url: string | null;
  trackerProject: { id: string; name: string };
  /** 트래커 상태. 기준은 언제나 트래커다(ADR 0001) */
  trackerState: { name: string; category: TrackerStateCategory };
  labels: ReadonlyArray<{ name: string; autoAssign: boolean }>;
  /** 새 것부터 */
  runs: ReadonlyArray<TicketRun>;
  assignability: Assignability;
}

/** 수동 할당에서 고를 러너. 러너는 Workspace 밖 자원이다(ADR 0006) */
export interface RunnerChoice {
  id: string;
  name: string;
  online: boolean;
  /** GitHub 인증이 깨져 고를 수 없다(Q82.14·Q87) */
  assignmentBlocked: boolean;
  projects: ReadonlyArray<string>;
}

/**
 * 티켓을 읽지 못한 트래커 프로젝트 하나.
 * - unauthorized: 트래커가 인증 정보를 받지 않았다
 * - rate-limited: 요청 한도를 넘었다
 * - not-found: 트래커에 그 프로젝트가 없다
 * - network: 트래커에 닿지 못했다
 * - unknown-connection: 묶인 트래커 연결이 없어졌다
 * - failed: 그 밖(설정을 읽지 못함, 트래커가 모르는 오류를 냄)
 */
export interface TrackerLoadError {
  trackerProject: string;
  reason:
    | "unauthorized"
    | "rate-limited"
    | "not-found"
    | "network"
    | "unknown-connection"
    | "failed";
}

export interface TicketsPage {
  workspace: WorkspaceChoice;
  /** 트래커에서 마지막으로 바뀐 것부터 */
  tickets: TicketView[];
  runners: RunnerChoice[];
  /** 설치의 모든 Mapping 에 쓰인 에이전트(중복 없음). 할당 창에서 기본값을 맨 앞에 둔다 */
  agents: string[];
  errors: TrackerLoadError[];
  /** Workspace 에 묶은 트래커 프로젝트가 있는지. 없으면 빈 목록 대신 묶으라고 안내한다 */
  hasTrackerProjects: boolean;
}

/** 시안 B 의 필터. "실행 중"은 Running 만 든다. Queued 는 넣지 않는다(0034) */
export const TICKET_FILTERS = ["all", "attention", "unassigned", "running", "merged"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

export function lastRun(ticket: TicketView): TicketRun | undefined {
  return ticket.runs[0];
}

/**
 * 손댈 일인 티켓: 마지막 런이 입력 기다림·연결 끊김이거나, 요약 결과가 Failed 이거나, 사람이 아직 PR 을
 * 정리하지 않은 Human Check 다(홈의 손댈 일과 같은 규칙, Q88·Q89). Canceled 는 올리지 않는다.
 */
export function needsAttention(run: TicketRun): boolean {
  switch (run.state) {
    case "waiting-for-input":
    case "disconnected":
      return true;
    case "ended":
      return run.summary === "failed" || (run.summary === "human-check" && !run.prSettledLater);
    case "queued":
    case "running":
      return false;
  }
}

export function matchesFilter(ticket: TicketView, filter: TicketFilter): boolean {
  const run = lastRun(ticket);
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return run !== undefined && needsAttention(run);
    case "unassigned":
      return run === undefined;
    case "running":
      return run?.state === "running";
    case "merged":
      return run?.state === "ended" && run.summary === "merged";
  }
}

/**
 * 할당 창에서 고를 러너: Mapping 의 러너 쪽 프로젝트가 있는 러너. 인증이 깨진 러너도 보이되 고를 수 없다(Q87).
 * Offline 러너는 고를 수 있다(core checkManualRunnerChoice). 그 러너가 Online 이 될 때까지 Queued 로 기다린다.
 */
export function runnersFor(
  runners: ReadonlyArray<RunnerChoice>,
  runnerProject: string,
): RunnerChoice[] {
  return runners.filter((runner) => runner.projects.includes(runnerProject));
}

/** 할당 창의 에이전트 선택지. Mapping 기본값을 맨 앞에 둔다 */
export function agentsFor(agents: ReadonlyArray<string>, defaultAgent: string): string[] {
  return [defaultAgent, ...agents.filter((agent) => agent !== defaultAgent)];
}
