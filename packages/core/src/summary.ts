import type { PrState, RunAxes, SummaryOutcome, WorktreeDisposition } from "./run.js";

export interface RunOutcomeSummary {
  outcome: SummaryOutcome;
  worktree: WorktreeDisposition;
}

export function summarizeRunOutcome(axes: RunAxes): RunOutcomeSummary {
  const { agentResult, prState } = axes;
  switch (agentResult) {
    case "could-not-start":
      return { outcome: "failed", worktree: "nothing-to-remove" };
    case "canceled":
      return {
        outcome: "canceled",
        worktree: axes.runnerUnreached ? "operator-decides" : keepIfOpen(prState),
      };
    case "ended-without-report":
    case "timed-out":
    case "stopped-waiting-for-input":
      return { outcome: "failed", worktree: keepIfOpen(prState) };
    case "runner-disconnected":
      return { outcome: "failed", worktree: "operator-decides" };
    case "worktree-missing":
      return { outcome: "failed", worktree: "nothing-to-remove" };
    case "reported-success":
    case "reported-failure":
      return summarizeReportedRun(prState);
  }
}

function keepIfOpen(prState: PrState): WorktreeDisposition {
  return prState === "open" || prState === "unknown" ? "keep-until-pr-settles" : "remove-now";
}

function summarizeReportedRun(prState: PrState): RunOutcomeSummary {
  switch (prState) {
    case "merged":
      return { outcome: "merged", worktree: "remove-now" };
    case "open":
    case "unknown":
      return { outcome: "human-check", worktree: "keep-until-pr-settles" };
    case "closed":
    case "none":
      return { outcome: "failed", worktree: "remove-now" };
  }
}
