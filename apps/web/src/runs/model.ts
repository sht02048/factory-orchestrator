import type { AgentResult, PrState, SummaryOutcome } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";

/*
 * Runs 화면이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값만 담는다. 문구는 메시지 파일이 정한다.
 */

/**
 * Queued 런이 왜 아직 시작하지 않았는지(GLOSSARY Queued, Q65·Q68).
 * - starting: 앞이 비었고 러너에 남은 capacity 가 있어 worker 가 곧 시작한다
 * - no-capacity: 맨 앞 런인데 정한 러너에 남은 capacity 가 없다(뒤 런을 막는다)
 * - behind: 앞 런이 시작하기를 기다린다(엄격한 FIFO, Q63 개정)
 * - runner-offline: 맞는 러너가 모두 Offline 이라 러너를 정하지 못했다. 순서에서 빠진다(Q68·Q72)
 * - project-missing: 러너에서 그 런의 러너 쪽 프로젝트가 빠져 러너를 다시 고른다. 순서에서 빠진다(Q78·Q82.13)
 * - assignment-blocked: 맞는 러너의 GitHub 인증이 깨져 기다린다. 순서에서 빠진다(Q82.22·Q87)
 */
export type QueuedReason =
  | {
      kind: "starting" | "behind" | "runner-offline" | "project-missing" | "assignment-blocked";
    }
  | { kind: "no-capacity"; runner: string };

interface RunViewBase {
  id: string;
  ticketKey: string;
  /** 트래커 프로젝트 이름. Workspace 에서 뺀 트래커 프로젝트면 ID */
  trackerProject: string;
  /** 러너에서 받은 실제 브랜치(Q82.6). 시작하지 않은 런이면 null */
  branch: string | null;
  /** 러너. Queued 에서 아직 정하지 않았으면 null */
  runner: { name: string; online: boolean } | null;
  agent: string;
  /** 할당부터 시작까지(시작하지 않았으면 지금까지) */
  waitMs: number;
  /** 시작부터 종료까지(끝나지 않았으면 지금까지). 시작하지 않았으면 null */
  executionMs: number | null;
  /** 런과 이어진 PR. worker 가 찾기 전이면 null */
  pullRequest: { displayId: string; url: string } | null;
  /**
   * 손댈 일(GLOSSARY)에 드는 런인가. Home 과 같은 규칙이다: Waiting for Input·Disconnected 런, 그리고
   * 티켓마다 마지막 런만 보아 Failed 와 PR 이 아직 정리되지 않은 Human Check(Q54·Q88·Q89)
   */
  attention: boolean;
}

/**
 * 처리되지 않은 취소 요청이 있는지(취소 중, Q82.21). 런 상태가 아니라 끝나지 않은 런의 화면 표시다.
 * Ended 런에는 없다.
 */
interface Cancellable {
  cancelling: boolean;
}

export type RunView =
  | (RunViewBase & Cancellable & { state: "queued"; queuedReason: QueuedReason })
  | (RunViewBase & Cancellable & { state: "running" | "waiting-for-input" | "disconnected" })
  | (RunViewBase & {
      state: "ended";
      /** 끝난 시각(ISO). 하루가 넘으면 날짜로 쓴다 */
      endedAt: string;
      /** 끝난 때부터 서버가 읽은 때까지. 목록의 상대 시간("53분 전")에 쓴다 */
      endedAgoMs: number;
      agentResult: AgentResult;
      prState: PrState;
      /** core summarizeRunOutcome 으로 계산한 값 */
      summary: SummaryOutcome;
    });

export interface RunsPage {
  workspace: WorkspaceChoice;
  /** 새 것부터 */
  runs: RunView[];
  moreEnded: boolean;
}

export const ENDED_RUNS_PAGE_SIZE = 50;
export const MAX_ENDED_RUNS = 5000;

/**
 * 상태 칩 필터(Q66·Q67, ADR 0010): 전체, 손댈 일, Ended 가 아닌 상태 넷과 Ended 의 요약 결과 넷.
 * 손댈 일은 Home 과 같은 런을 묶은 필터라 런 하나가 손댈 일과 그 상태 칩에 함께 든다.
 */
export const RUN_FILTERS = [
  "all",
  "attention",
  "running",
  "waiting-for-input",
  "disconnected",
  "queued",
  "merged",
  "human-check",
  "failed",
  "canceled",
] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export type RunFilterKey = Exclude<RunFilter, "all" | "attention">;

/** 런이 드는 상태 칩. Ended 는 요약 결과로 나눈다 */
export function filterKeyOf(run: RunView): RunFilterKey {
  return run.state === "ended" ? run.summary : run.state;
}

export function needsAttention(run: RunView): boolean {
  return run.attention;
}

export function matchesFilter(run: RunView, filter: RunFilter): boolean {
  if (filter === "all") return true;
  if (filter === "attention") return needsAttention(run);
  return filterKeyOf(run) === filter;
}

/** 진행 중인 런의 경과: Queued 는 기다린 시간, 그 밖은 실행 시간 */
export function elapsedMs(run: RunView): number {
  return run.executionMs ?? run.waitMs;
}
