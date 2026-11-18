import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { QueuedReason } from "../runs/model";
import type { RunnerIssueCause, WorkspaceChoice, WorkspaceSummary } from "../shell/model";

/*
 * 홈 화면이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값과 외부에서 온 글(질문 본문, 선택지)만 담는다.
 */

/**
 * Waiting for Input 런이 무엇을 기다리는지(GLOSSARY Waiting for Input, Q82.3·Q82.4).
 * - question: 에이전트의 질문. 운영자가 답하면 DB 에 답을 남기고 worker 가 보낸다
 * - permission: 권한 프롬프트. 허용은 러너 화면에서만 하고, 여기서는 거절만 한다
 */
export type InputWait =
  | {
      kind: "question";
      questionId: string;
      body: string;
      /** 에이전트가 준 선택지. 없으면 빈 배열 */
      choices: string[];
      /** 운영자가 답을 남겼고 worker 가 아직 보내지 않았다 */
      answered: boolean;
    }
  | {
      kind: "permission";
      promptId: string;
      /** 무엇을 허용하려는지. 러너가 준 글 그대로 */
      detail: string;
      /** 운영자가 거절을 남겼고 worker 가 아직 보내지 않았다 */
      denied: boolean;
    };

interface HomeRunBase {
  id: string;
  ticketKey: string;
  /** 트래커 프로젝트 이름. Workspace 에서 뺀 트래커 프로젝트면 ID */
  trackerProject: string;
  workspace: WorkspaceSummary;
  /** 러너. Queued 에서 아직 정하지 않았거나 비웠으면 null */
  runner: { name: string; online: boolean } | null;
  agent: string;
  /** 할당부터 시작까지(시작하지 않았으면 지금까지) */
  waitMs: number;
  /** 시작부터 종료까지(끝나지 않았으면 지금까지). 시작하지 않았으면 null */
  executionMs: number | null;
  pullRequest: { displayId: string; url: string } | null;
  /** 처리되지 않은 취소 요청이 있다. 런 상태가 아니라 화면 표시다(Q82.21) */
  cancelling: boolean;
}

export type HomeRun =
  | (HomeRunBase & { state: "queued"; queuedReason: QueuedReason })
  | (HomeRunBase & { state: "running" })
  | (HomeRunBase & {
      state: "waiting-for-input";
      /** 기다리는 입력. worker 가 아직 읽지 않았으면 null */
      input: InputWait | null;
    })
  | (HomeRunBase & {
      state: "disconnected";
      /** ssh 가 실패하기 시작한 때부터 지금까지. 기록이 없으면 null */
      unreachableMs: number | null;
    })
  | (HomeRunBase & {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      /** core summarizeRunOutcome 으로 계산한 값 */
      summary: SummaryOutcome;
      /** 런이 끝난 뒤 사람이 PR 을 병합하거나 닫았다(이후 PR 상태, Q54·Q69) */
      prSettledLater: boolean;
    });

/**
 * Runner Issue 인 러너(ADR 0010 1번). 까닭은 설명 문장으로 보인다.
 * Offline 이거나 GitHub 인증이 깨져 할당에서 빠졌다(Q82.14·Q82.15).
 */
export interface RunnerIssue {
  id: string;
  name: string;
  cause: RunnerIssueCause;
}

/** 손댈 일 카드 하나. 런이거나 러너다 */
export type AttentionItem =
  | { kind: "run"; run: HomeRun }
  | { kind: "runner-issue"; runner: RunnerIssue };

/**
 * "지금 일어나는 일" 흐름의 사건(ADR 0010 Consequences). DB 에 이미 있는 기록만 쓴다.
 * - started: 런이 러너에서 시작했다(Queued → Running)
 * - question / permission: 에이전트가 질문했거나 권한 허용을 기다리기 시작했다
 * - disconnected: 런 중 러너에 닿지 않아 Disconnected 가 됐다
 * - ended: 런이 끝났다. 요약 결과를 함께 둔다
 * - later-pr: 런이 끝난 뒤 사람이 PR 을 병합하거나 닫았다(Q54·Q69)
 */
export type ActivityEvent =
  | { kind: "started" | "question" | "permission" | "disconnected" }
  | { kind: "ended"; summary: SummaryOutcome }
  | { kind: "later-pr"; state: "merged" | "closed" };

export interface Activity {
  /** 흐름 안에서 겹치지 않는 값 */
  key: string;
  runId: string;
  ticketKey: string;
  /** "전체"에서 어느 Workspace 의 런인지 */
  workspace: WorkspaceSummary;
  event: ActivityEvent;
  at: string;
  /** 사건부터 서버가 읽은 때까지 */
  agoMs: number;
}

export interface HomePage {
  workspace: WorkspaceChoice;
  attention: AttentionItem[];
  /** "전체"에서는 비어 있다(ADR 0006) */
  running: HomeRun[];
  /** 들어온 순서. "전체"에서는 비어 있다 */
  queued: HomeRun[];
  /** 오늘(운영자 시간대) Merged 로 끝난 런 수. "전체"에서는 0 이다 */
  mergedToday: number;
  /** 지금 일어나는 일. 새 것부터 */
  activity: Activity[];
}

export function attentionKey(item: AttentionItem): string {
  return item.kind === "run" ? `run:${item.run.id}` : `runner:${item.runner.id}`;
}

/** 손댈 일에 올릴 런인가. Canceled 처럼 여기 없는 요약 결과는 올리지 않는다(Q82.9) */
export function needsAttention(run: HomeRun): boolean {
  switch (run.state) {
    case "waiting-for-input":
    case "disconnected":
      return true;
    case "ended":
      // Human Check 런은 사람이 PR 을 병합하거나 닫으면 뺀다. 요약 결과는 그대로다(Q54·Q89).
      return (run.summary === "human-check" && !run.prSettledLater) || run.summary === "failed";
    case "queued":
    case "running":
      return false;
  }
}

/**
 * 홈의 손댈 일과 Running·Queued 수를 나눈다.
 *
 * - 손댈 일: Runner Issue 러너(Offline, GitHub 인증 깨짐), Waiting for Input·Disconnected 런,
 *   요약 결과가 Human Check·Failed 인 Ended 런.
 *   Ended 런은 티켓마다 마지막 런만 본다(시안 B, Q88). 같은 티켓에 새 런이 있으면 지난 결과는 손댈 일이 아니다.
 * - 실행 중: Running 런
 * - Queued: Queued 런, 들어온 순서
 *
 * `runs` 는 할당 순서(대기열 순서)로 받는다. "전체"면 손댈 일만 채운다(ADR 0006).
 */
export function partitionHome(input: {
  workspace: WorkspaceChoice;
  /** ticket: 트래커 연결과 티켓 키로 만든 티켓 식별값 */
  runs: ReadonlyArray<{ ticket: string; run: HomeRun }>;
  runnerIssues: ReadonlyArray<RunnerIssue>;
  mergedToday: number;
  activity: Activity[];
}): HomePage {
  const { workspace, activity } = input;
  if (workspace.kind === "none")
    return { workspace, attention: [], running: [], queued: [], mergedToday: 0, activity: [] };

  const latestByTicket = new Map<string, string>();
  for (const { ticket, run } of input.runs) latestByTicket.set(ticket, run.id);

  const attentionRuns = input.runs
    .flatMap(({ ticket, run }, index) =>
      needsAttention(run) && (run.state !== "ended" || latestByTicket.get(ticket) === run.id)
        ? [{ run, index }]
        : [],
    )
    // 에이전트가 기다리는 런(입력 기다림, 연결 끊김)을 먼저, 그 안에서는 새 것부터
    .toSorted((a, b) => urgency(a.run) - urgency(b.run) || b.index - a.index)
    .map(({ run }): AttentionItem => ({ kind: "run", run }));

  const attention: AttentionItem[] = [
    ...input.runnerIssues.map((runner): AttentionItem => ({ kind: "runner-issue", runner })),
    ...attentionRuns,
  ];
  if (workspace.kind === "all")
    return { workspace, attention, running: [], queued: [], mergedToday: 0, activity };

  const runs = input.runs.map(({ run }) => run);
  return {
    workspace,
    attention,
    running: runs.filter((run) => run.state === "running"),
    queued: runs.filter((run) => run.state === "queued"),
    mergedToday: input.mergedToday,
    activity,
  };
}

function urgency(run: HomeRun): number {
  switch (run.state) {
    case "waiting-for-input":
      return 0;
    case "disconnected":
      return 1;
    case "ended":
    case "queued":
    case "running":
      return 2;
  }
}
