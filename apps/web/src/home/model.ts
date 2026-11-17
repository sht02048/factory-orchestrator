import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { QueuedReason } from "../runs/model";
import type { WorkspaceChoice, WorkspaceSummary } from "../shell/model";

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

/** GitHub 인증이 깨져 할당에서 빠진 러너(Q82.14·Q82.15) */
export interface BrokenAuthRunner {
  id: string;
  name: string;
}

/** 손댈 일 한 줄. 런이거나 러너다 */
export type AttentionItem =
  | { kind: "run"; run: HomeRun }
  | { kind: "runner-auth"; runner: BrokenAuthRunner };

export interface HomePage {
  workspace: WorkspaceChoice;
  attention: AttentionItem[];
  /** "전체"에서는 비어 있다(ADR 0006) */
  running: HomeRun[];
  /** 들어온 순서. "전체"에서는 비어 있다 */
  queued: HomeRun[];
}

/** 손댈 일 행·패널을 고르는 값 */
export function attentionKey(item: AttentionItem): string {
  return item.kind === "run" ? `run:${item.run.id}` : `runner:${item.runner.id}`;
}

export function runKey(run: HomeRun): string {
  return `run:${run.id}`;
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
 * 홈의 세 구역으로 나눈다.
 *
 * - 손댈 일: GitHub 인증이 깨진 러너, 입력 기다림·연결 끊김 런, 요약 결과가 Human Check·Failed 인 Ended 런.
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
  brokenAuthRunners: ReadonlyArray<BrokenAuthRunner>;
}): HomePage {
  const { workspace } = input;
  if (workspace.kind === "none") return { workspace, attention: [], running: [], queued: [] };

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
    ...input.brokenAuthRunners.map((runner): AttentionItem => ({ kind: "runner-auth", runner })),
    ...attentionRuns,
  ];
  if (workspace.kind === "all") return { workspace, attention, running: [], queued: [] };

  const runs = input.runs.map(({ run }) => run);
  return {
    workspace,
    attention,
    running: runs.filter((run) => run.state === "running"),
    queued: runs.filter((run) => run.state === "queued"),
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
