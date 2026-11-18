import { describe, expect, it } from "vitest";

import { AGENT_RESULTS, PR_STATES } from "./run.js";
import type { AgentResult, PrState, SummaryOutcome, WorktreeDisposition } from "./run.js";
import { summarizeRunOutcome } from "./summary.js";

type Cell = [SummaryOutcome, WorktreeDisposition];

const keepIfOpen = (outcome: SummaryOutcome): Record<PrState, Cell> => ({
  open: [outcome, "keep-until-pr-settles"],
  none: [outcome, "remove-now"],
  merged: [outcome, "remove-now"],
  closed: [outcome, "remove-now"],
});
const same = (cell: Cell): Record<PrState, Cell> => ({
  open: cell,
  none: cell,
  merged: cell,
  closed: cell,
});
const reported: Record<PrState, Cell> = {
  merged: ["merged", "remove-now"],
  open: ["human-check", "keep-until-pr-settles"],
  closed: ["failed", "remove-now"],
  none: ["failed", "remove-now"],
};

const EXPECTED: Record<AgentResult, Record<PrState, Cell>> = {
  "reported-success": reported,
  "reported-failure": reported,
  "ended-without-report": keepIfOpen("failed"),
  "timed-out": keepIfOpen("failed"),
  "stopped-waiting-for-input": keepIfOpen("failed"),
  "runner-disconnected": same(["failed", "operator-decides"]),
  "worktree-missing": same(["failed", "nothing-to-remove"]),
  canceled: keepIfOpen("canceled"),
  "could-not-start": same(["failed", "nothing-to-remove"]),
};
const CANCELED_UNREACHED: Cell = ["canceled", "operator-decides"];

const AXES = AGENT_RESULTS.flatMap((agentResult) =>
  (agentResult === "could-not-start" ? (["none"] as const) : PR_STATES).map(
    (prState) => [agentResult, prState] as const,
  ),
);
const ALL_COMBINATIONS = AXES.flatMap(
  ([agentResult, prState]) =>
    [
      [agentResult, prState, false],
      [agentResult, prState, true],
    ] as const,
);

describe("summarizeRunOutcome", () => {
  it("에이전트 결과 아홉 × PR 상태 넷(시작할 수 없음은 없음만)은 서른세 조합이다", () => {
    expect(AGENT_RESULTS).toHaveLength(9);
    expect(AXES).toHaveLength(33);
    expect(ALL_COMBINATIONS).toHaveLength(66);
  });

  it.each(ALL_COMBINATIONS)(
    "%s + %s (러너에 닿지 못함 %s) 는 요약 계산 표대로 계산한다",
    (agentResult, prState, runnerUnreached) => {
      const [outcome, worktree] =
        agentResult === "canceled" && runnerUnreached
          ? CANCELED_UNREACHED
          : EXPECTED[agentResult][prState];

      expect(summarizeRunOutcome({ agentResult, prState, runnerUnreached })).toEqual({
        outcome,
        worktree,
      });
    },
  );

  it("완료 보고(실패) + 열림은 outcome과 상관없이 Human Check다 (Q66·Q82.2)", () => {
    expect(
      summarizeRunOutcome({
        agentResult: "reported-failure",
        prState: "open",
        runnerUnreached: false,
      }),
    ).toEqual({ outcome: "human-check", worktree: "keep-until-pr-settles" });
  });

  it.each(PR_STATES)(
    "운영자가 취소함은 PR 상태(%s)와 상관없이 Canceled다 (Q77·Q82.18)",
    (prState) => {
      for (const runnerUnreached of [false, true]) {
        expect(
          summarizeRunOutcome({ agentResult: "canceled", prState, runnerUnreached }).outcome,
        ).toBe("canceled");
      }
    },
  );

  it("러너에 닿지 못한 채 끝난 취소 런은 워크트리를 자동으로 지우지 않는다 (Q82.21)", () => {
    expect(
      summarizeRunOutcome({ agentResult: "canceled", prState: "open", runnerUnreached: true }),
    ).toEqual({ outcome: "canceled", worktree: "operator-decides" });
  });

  it("시작할 수 없음은 Failed이고 지울 워크트리가 없다 (Q82.16·Q82.20)", () => {
    expect(
      summarizeRunOutcome({
        agentResult: "could-not-start",
        prState: "none",
        runnerUnreached: false,
      }),
    ).toEqual({ outcome: "failed", worktree: "nothing-to-remove" });
  });
});
