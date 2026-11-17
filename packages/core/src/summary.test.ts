import { describe, expect, it } from "vitest";

import { AGENT_RESULTS, PR_STATES } from "./run.js";
import type { AgentResult, PrState, SummaryOutcome, WorktreeDisposition } from "./run.js";
import { summarizeRunOutcome } from "./summary.js";

// 스펙 4.2 요약 계산 표를 스물네 칸으로 펼쳐 적은 것. 구현의 표와 따로 적어 서로 대조한다.
const EXPECTED: Record<AgentResult, Record<PrState, [SummaryOutcome, WorktreeDisposition]>> = {
  "timed-out": {
    open: ["failed", "keep-until-pr-settles"],
    none: ["failed", "remove-now"],
    merged: ["failed", "remove-now"],
    closed: ["failed", "remove-now"],
  },
  "stopped-waiting-for-input": {
    open: ["failed", "keep-until-pr-settles"],
    none: ["failed", "remove-now"],
    merged: ["failed", "remove-now"],
    closed: ["failed", "remove-now"],
  },
  "runner-disconnected": {
    open: ["failed", "operator-decides"],
    none: ["failed", "operator-decides"],
    merged: ["failed", "operator-decides"],
    closed: ["failed", "operator-decides"],
  },
  "worktree-missing": {
    open: ["failed", "nothing-to-remove"],
    none: ["failed", "nothing-to-remove"],
    merged: ["failed", "nothing-to-remove"],
    closed: ["failed", "nothing-to-remove"],
  },
  "exited-normally": {
    merged: ["merged", "remove-now"],
    open: ["human-check", "keep-until-pr-settles"],
    closed: ["failed", "remove-now"],
    none: ["failed", "remove-now"],
  },
  "exited-with-error": {
    merged: ["merged", "remove-now"],
    open: ["human-check", "keep-until-pr-settles"],
    closed: ["failed", "remove-now"],
    none: ["failed", "remove-now"],
  },
};

const ALL_COMBINATIONS = AGENT_RESULTS.flatMap((agentResult) =>
  PR_STATES.map((prState) => [agentResult, prState] as const),
);

describe("summarizeRunOutcome", () => {
  it("에이전트 결과 여섯 × PR 상태 넷이 스물네 조합이다", () => {
    expect(ALL_COMBINATIONS).toHaveLength(24);
  });

  it.each(ALL_COMBINATIONS)("%s + %s 는 요약 계산 표대로 계산한다", (agentResult, prState) => {
    const [outcome, worktree] = EXPECTED[agentResult][prState];

    expect(summarizeRunOutcome(agentResult, prState)).toEqual({ outcome, worktree });
  });

  it("오류 종료 + 열림은 종료 코드와 상관없이 Human Check다 (Q66)", () => {
    expect(summarizeRunOutcome("exited-with-error", "open")).toEqual({
      outcome: "human-check",
      worktree: "keep-until-pr-settles",
    });
  });
});
