import type { AgentResult, PrState, SummaryOutcome, WorktreeDisposition } from "./run.js";

export interface RunOutcomeSummary {
  outcome: SummaryOutcome;
  worktree: WorktreeDisposition;
}

/**
 * 스펙 4.2 요약 계산 표. 두 축(에이전트 결과, PR 상태)에서 요약 결과와 워크트리 처리를 정하는
 * 유일한 곳이다(CODING_STANDARDS 「요약 결과는 계산 함수 하나로만 정한다」).
 * 화면·통계·worker는 두 축을 직접 해석하지 말고 이 함수를 부른다.
 *
 * | 에이전트 결과                 | PR 상태  | 요약 결과   | 워크트리              |
 * | ----------------------------- | -------- | ----------- | --------------------- |
 * | 시간 초과, 입력 기다리다 멈춤 | 열림     | Failed      | keep-until-pr-settles |
 * | 시간 초과, 입력 기다리다 멈춤 | 그 밖    | Failed      | remove-now            |
 * | 러너 연결 끊김                | 무엇이든 | Failed      | operator-decides      |
 * | 워크트리 없음                 | 무엇이든 | Failed      | nothing-to-remove     |
 * | 정상 종료, 오류 종료          | 병합됨   | Merged      | remove-now            |
 * | 정상 종료, 오류 종료          | 열림     | Human Check | keep-until-pr-settles |
 * | 정상 종료, 오류 종료          | 닫힘     | Failed      | remove-now            |
 * | 정상 종료, 오류 종료          | 없음     | Failed      | remove-now            |
 */
export function summarizeRunOutcome(agentResult: AgentResult, prState: PrState): RunOutcomeSummary {
  switch (agentResult) {
    case "timed-out":
    case "stopped-waiting-for-input":
      // 시간 초과 예외(Q51): 요약은 Failed지만 열린 PR과 워크트리는 남긴다.
      return {
        outcome: "failed",
        worktree: prState === "open" ? "keep-until-pr-settles" : "remove-now",
      };
    case "runner-disconnected":
      // 러너 연결 끊김 예외(Q67·Q75): 자동으로 지우지 않는다.
      return { outcome: "failed", worktree: "operator-decides" };
    case "worktree-missing":
      return { outcome: "failed", worktree: "nothing-to-remove" };
    case "exited-normally":
    case "exited-with-error":
      // 종료 코드는 요약 결과를 바꾸지 않는다(Q66).
      return summarizeSelfEndedRun(prState);
  }
}

function summarizeSelfEndedRun(prState: PrState): RunOutcomeSummary {
  switch (prState) {
    case "merged":
      return { outcome: "merged", worktree: "remove-now" };
    case "open":
      return { outcome: "human-check", worktree: "keep-until-pr-settles" };
    case "closed":
    case "none":
      return { outcome: "failed", worktree: "remove-now" };
  }
}
