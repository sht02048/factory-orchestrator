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
 */
export type QueuedReason =
  | { kind: "starting" | "behind" | "runner-offline" }
  | { kind: "no-capacity"; runner: string };

interface RunViewBase {
  id: string;
  ticketKey: string;
  /** 트래커 프로젝트 이름. Workspace 에서 뺀 트래커 프로젝트면 ID */
  trackerProject: string;
  branch: string;
  /** 러너. Queued 에서 아직 정하지 않았으면 null */
  runner: { name: string; online: boolean } | null;
  agent: string;
  /** 할당부터 시작까지(시작하지 않았으면 지금까지) */
  waitMs: number;
  /** 시작부터 종료까지(끝나지 않았으면 지금까지). 시작하지 않았으면 null */
  executionMs: number | null;
  /** 런과 이어진 PR. worker 가 찾기 전이면 null */
  pullRequest: { displayId: string; url: string } | null;
}

export type RunView =
  | (RunViewBase & { state: "queued"; queuedReason: QueuedReason })
  | (RunViewBase & { state: "running" | "waiting-for-input" | "disconnected" })
  | (RunViewBase & {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      /** core summarizeRunOutcome 으로 계산한 값 */
      summary: SummaryOutcome;
    });

export interface RunsPage {
  workspace: WorkspaceChoice;
  /** 새 것부터 */
  runs: RunView[];
}

/** 상태 필터(Q66·Q67): Ended 가 아닌 상태 넷과 Ended 의 요약 결과 셋 */
export const RUN_FILTERS = [
  "all",
  "queued",
  "running",
  "waiting-for-input",
  "disconnected",
  "merged",
  "human-check",
  "failed",
] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export type RunFilterKey = Exclude<RunFilter, "all">;

/** 런이 드는 필터. Ended 는 요약 결과로 나눈다 */
export function filterKeyOf(run: RunView): RunFilterKey {
  return run.state === "ended" ? run.summary : run.state;
}

export function matchesFilter(run: RunView, filter: RunFilter): boolean {
  return filter === "all" || filterKeyOf(run) === filter;
}

/** 목록의 경과 칸: Queued 는 기다린 시간, 그 밖은 실행 시간 */
export function elapsedMs(run: RunView): number {
  return run.executionMs ?? run.waitMs;
}
