import type { AgentResult, PrState, RunState, SummaryOutcome } from "@factory/core";
import type { InputWait } from "../home/model";
import type { QueuedReason } from "../runs/model";

/*
 * Run 상세 화면이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값과 원문(질문 본문, 완료 보고 본문, 로그)만 담는다. 문구는 메시지 파일이 정한다.
 * 시각은 ISO 문자열로 담는다(server function 경계를 그대로 건넌다).
 */

/**
 * PR 의 CI 상태(Q79). CI 는 선택 표시라 요약 결과에 쓰지 않는다.
 * - unavailable: 토큰에 CI 를 읽을 권한이 없어 볼 수 없다
 * - unknown: 코드 호스트가 준 값이 위 어느 것도 아니다
 */
export type CiView = "success" | "failure" | "pending" | "none" | "unavailable" | "unknown";

/**
 * 타임라인의 일 하나(Q67·Q82). 시각 순서로 둔다.
 * - assigned: 할당(Queued 에 들어옴)
 * - started: 러너에서 시작
 * - waiting-for-input: 입력을 기다리기 시작
 * - question / answer: 에이전트 질문과 운영자 답(Q82.3)
 * - permission / denied: 권한 대기와 운영자 거절(Q82.4)
 * - unreachable: ssh 가 실패하기 시작(연결 끊김 판단의 시작, Q50)
 * - disconnected / reconnected: 연결 끊김과 다시 연결(Q67)
 * - resumed: 입력 기다림에서 다시 실행
 * - cancel-requested: 운영자가 취소를 요청(Q77·Q82.8)
 * - ended: 종료. 에이전트 결과를 함께 둔다
 * - later-pr: 런이 끝난 뒤 사람이 PR 을 병합하거나 닫음(Q54·Q69)
 */
export type TimelineEvent = { at: string } & (
  | { kind: "assigned" | "started" | "waiting-for-input" | "resumed" }
  | { kind: "unreachable" | "disconnected" | "reconnected" }
  | { kind: "question" | "answer" | "permission"; body: string }
  | { kind: "denied"; body: string }
  | { kind: "cancel-requested" }
  | { kind: "ended"; agentResult: AgentResult }
  | { kind: "later-pr"; state: "merged" | "closed" }
);

/**
 * 에이전트가 사람 입력을 기다리는 까닭(Q82.3·Q82.4). Waiting for Input 런에만 있다.
 * 질문과 권한 대기는 홈의 손댈 일과 같은 값이다(home InputWait). unknown 은 worker 가 아직 기록하지 않았다.
 */
export type PendingInput = InputWait | { kind: "unknown" };

/**
 * 로그 꼬리(Q46·Q61). web 은 ssh 를 쓰지 않고 DB 에 요청을 남기고 worker 가 쓴 결과를 읽는다.
 * - stored: Ended 런. 끝날 때 저장한 마지막 200줄
 * - pending: 요청했고 worker 결과를 기다린다
 * - done / failed: worker 가 쓴 결과
 * - none: 시작하지 않은 런이라 로그가 없다
 */
export type LogTailView =
  | { kind: "none" }
  | { kind: "stored"; lines: string[] }
  | { kind: "pending" }
  | { kind: "done"; lines: string[]; at: string }
  | { kind: "failed"; error: string; at: string };

/** 런 상태별 값. Ended 에만 두 축과 요약 결과가 있다 */
export type RunDetailStatus =
  | { state: "queued"; queuedReason: QueuedReason }
  | { state: "running" }
  | {
      state: "waiting-for-input";
      input: PendingInput;
      /** 지금 기다리는 질문을 받거나 권한을 요청한 시각(ISO). 입력을 모르면 null */
      inputSince: string | null;
    }
  | {
      state: "disconnected";
      /** ssh 가 연속으로 실패하기 시작한 시각(Q50·Q67). 기록이 없으면 null */
      unreachableSince: string | null;
    }
  | {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      /** core summarizeRunOutcome 으로 계산한 값 */
      summary: SummaryOutcome;
      /** 사람이 러너에서 워크트리를 지워야 한다(Q75·Q82.21). 지우기 버튼은 두지 않는다 */
      worktreeNeedsManualRemoval: boolean;
      /** 런이 끝난 뒤 사람이 PR 을 병합하거나 닫았으면 그 상태(Q54·Q69) */
      laterPrState: { state: "merged" | "closed"; at: string } | null;
    };

/** 같은 티켓의 다른 런 한 줄(시안 B) */
export type OtherRun = { id: string; assignedAt: string } & (
  | { state: Exclude<RunState, "ended"> }
  | {
      state: "ended";
      /** Ended 런의 요약 결과 */
      summary: SummaryOutcome;
    }
);

export interface RunDetail {
  id: string;
  /** 서버가 이 데이터를 읽은 때. 지난 일의 상대 시간("25분 전")을 이 때로부터 잰다 */
  now: string;
  ticketKey: string;
  /** 트래커 프로젝트 이름. Workspace 에서 뺀 트래커 프로젝트면 ID */
  trackerProject: string;
  workspace: { id: string; name: string };
  /** 러너에서 받은 실제 브랜치(Q82.6). 시작하지 않은 런이면 null */
  branch: string | null;
  /** 러너의 워크트리 참조. 시작하지 않았으면 null */
  worktree: string | null;
  runner: { name: string; online: boolean } | null;
  agent: string;
  /** 할당 때 Mapping 에서 옮겨 적은 에이전트 모델(0043). 정하지 않았으면 null */
  model: string | null;
  assignedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** 할당부터 시작까지(시작하지 않았으면 지금까지) */
  waitMs: number;
  /** 시작부터 종료까지(끝나지 않았으면 지금까지). 시작하지 않았으면 null */
  executionMs: number | null;
  status: RunDetailStatus;
  /** 런과 이어진 PR 과 CI 상태(worker 가 DB 에 쓴 값, 0017). 찾기 전이거나 없으면 null */
  pullRequest: { displayId: string; url: string; ci: CiView } | null;
  /** 에이전트가 보낸 완료 보고 본문(Q82.2). 없으면 null */
  report: string | null;
  /** 시작할 수 없음으로 끝난 런의 마지막 시작 오류(Q86). 그 밖은 null */
  startError: string | null;
  /** 처리되지 않은 취소 요청이 있다(Q82.21). 런 상태가 아니라 화면 표시다 */
  cancelPending: boolean;
  timeline: TimelineEvent[];
  log: LogTailView;
  /** 같은 티켓의 다른 런. 새 것부터 */
  otherRuns: OtherRun[];
}

export type RunDetailPage = { kind: "found"; run: RunDetail } | { kind: "not-found" };

/** 끝나지 않은 런에만 취소 행동을 둔다(Q82.8) */
export function canCancel(run: RunDetail): boolean {
  return run.status.state !== "ended";
}
