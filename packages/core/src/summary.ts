import type { PrState, RunAxes, SummaryOutcome, WorktreeDisposition } from "./run.js";

export interface RunOutcomeSummary {
  outcome: SummaryOutcome;
  worktree: WorktreeDisposition;
}

/**
 * 스펙 4.2 요약 계산 표. 에이전트 결과, PR 상태, 운영자가 취소함의 러너에 닿지 못함 여부에서 요약 결과와
 * 워크트리 처리를 정하는 유일한 곳이다(CODING_STANDARDS 「요약 결과는 계산 함수 하나로만 정한다」).
 * 화면·통계·worker는 두 축을 직접 해석하지 말고 이 함수를 부른다. Ended 런을 그대로 넘길 수 있다.
 * CI 상태는 입력이 아니다(Q79).
 *
 * 위에서부터 처음 맞는 줄을 쓴다.
 *
 * | 에이전트 결과                              | PR 상태  | 요약 결과   | 워크트리              |
 * | ------------------------------------------ | -------- | ----------- | --------------------- |
 * | 시작할 수 없음                             | 없음     | Failed      | nothing-to-remove     |
 * | 운영자가 취소함(러너에 닿지 못한 채 끝남)  | 무엇이든 | Canceled    | operator-decides      |
 * | 운영자가 취소함                            | 열림     | Canceled    | keep-until-pr-settles |
 * | 운영자가 취소함                            | 그 밖    | Canceled    | remove-now            |
 * | 비정상 종료, 시간 초과, 입력 기다리다 멈춤 | 열림     | Failed      | keep-until-pr-settles |
 * | 비정상 종료, 시간 초과, 입력 기다리다 멈춤 | 그 밖    | Failed      | remove-now            |
 * | 러너 연결 끊김                             | 무엇이든 | Failed      | operator-decides      |
 * | 워크트리 없음                              | 무엇이든 | Failed      | nothing-to-remove     |
 * | 완료 보고(성공), 완료 보고(실패)           | 병합됨   | Merged      | remove-now            |
 * | 완료 보고(성공), 완료 보고(실패)           | 열림     | Human Check | keep-until-pr-settles |
 * | 완료 보고(성공), 완료 보고(실패)           | 닫힘     | Failed      | remove-now            |
 * | 완료 보고(성공), 완료 보고(실패)           | 없음     | Failed      | remove-now            |
 *
 * 시작할 수 없음은 PR을 찾지 않아 PR 상태가 늘 없음이다(Q82.20). `runnerUnreached`는 운영자가 취소함에서만
 * 뜻이 있고, 다른 에이전트 결과에서는 보지 않는다.
 */
export function summarizeRunOutcome(axes: RunAxes): RunOutcomeSummary {
  const { agentResult, prState } = axes;
  switch (agentResult) {
    case "could-not-start":
      return { outcome: "failed", worktree: "nothing-to-remove" };
    case "canceled":
      // 취소 예외(Q77·Q82.21): 요약은 PR 상태와 상관없이 Canceled다.
      return {
        outcome: "canceled",
        worktree: axes.runnerUnreached ? "operator-decides" : keepIfOpen(prState),
      };
    case "ended-without-report":
    case "timed-out":
    case "stopped-waiting-for-input":
      // 시간 초과 예외(Q51·Q82.19): 요약은 Failed지만 열린 PR과 워크트리는 남긴다.
      return { outcome: "failed", worktree: keepIfOpen(prState) };
    case "runner-disconnected":
      // 러너 연결 끊김 예외(Q67·Q75): 자동으로 지우지 않는다.
      return { outcome: "failed", worktree: "operator-decides" };
    case "worktree-missing":
      return { outcome: "failed", worktree: "nothing-to-remove" };
    case "reported-success":
    case "reported-failure":
      // 완료 보고의 outcome은 요약 결과를 바꾸지 않는다(Q66·Q82.2).
      return summarizeReportedRun(prState);
  }
}

function keepIfOpen(prState: PrState): WorktreeDisposition {
  return prState === "open" ? "keep-until-pr-settles" : "remove-now";
}

function summarizeReportedRun(prState: PrState): RunOutcomeSummary {
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
