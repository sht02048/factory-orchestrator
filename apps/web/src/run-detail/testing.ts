import {
  toAgentId,
  toAgentRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import type { AgentResult, PrState, RunId, SummaryOutcome } from "@factory/core";
import { assignRun, changeRunState } from "@factory/db";
import type { Database, RunStateChange } from "@factory/db";
import { connection, minutes } from "../testing/seed";

/*
 * Run 상세 테스트가 seedDatabase 위에 더하는 런. 가상 값만 쓴다.
 */

/** 시작한 런이 러너에서 받는 값 */
export function startedOn(key: string): Extract<RunStateChange, { to: "running" }> {
  return {
    to: "running",
    started: {
      worktree: toWorktreeRef(`wt-${key}`),
      branch: `acme/${key.toLowerCase()}`,
      agentRef: toAgentRef(`agent-${key}`),
    },
  };
}

/** 티켓 하나를 할당한다. 시각은 seed 의 T0 + at 분 */
export function assign(db: Database, key: string, at: number): RunId {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: minutes(at),
  });
  if (!result.ok) throw new Error(`assign ${key}: ${result.reason}`);
  return result.run.id;
}

/** 상태를 차례로 바꾼다. i 번째 변경은 T0 + at + 1 + i 분 */
export function walk(
  db: Database,
  id: RunId,
  at: number,
  steps: ReadonlyArray<RunStateChange>,
): void {
  steps.forEach((step, i) => {
    const r = changeRunState(db, id, step, minutes(at + 1 + i));
    if (!r.ok) throw new Error(JSON.stringify(r));
  });
}

export interface ExtraEndedCase {
  key: string;
  agentResult: AgentResult;
  prState: PrState;
  runnerUnreached: boolean;
  /** 시작하지 않고 끝났는지(Queued 에서 취소, 시작할 수 없음) */
  started: boolean;
  summary: SummaryOutcome;
}

/**
 * seed 의 Ended 런(에이전트 결과 여섯)에 더해 나머지 셋(비정상 종료, 운영자가 취소함, 시작할 수 없음)과
 * 러너에 닿지 못한 채 끝난 취소를 채운다. 둘을 합치면 core 의 에이전트 결과 아홉이 모두 나온다.
 */
export const extraEndedCases: ReadonlyArray<ExtraEndedCase> = [
  {
    key: "ACME-20",
    agentResult: "ended-without-report",
    prState: "open",
    runnerUnreached: false,
    started: true,
    summary: "failed",
  },
  {
    key: "ACME-21",
    agentResult: "canceled",
    prState: "open",
    runnerUnreached: false,
    started: true,
    summary: "canceled",
  },
  {
    key: "ACME-22",
    agentResult: "canceled",
    prState: "none",
    runnerUnreached: true,
    started: true,
    summary: "canceled",
  },
  {
    key: "ACME-23",
    agentResult: "canceled",
    prState: "none",
    runnerUnreached: false,
    started: false,
    summary: "canceled",
  },
  {
    key: "ACME-24",
    agentResult: "could-not-start",
    prState: "none",
    runnerUnreached: false,
    started: false,
    summary: "failed",
  },
];

/** extraEndedCases 를 DB 에 넣는다. 키 → 런 ID */
export function addExtraEnded(db: Database): Map<string, RunId> {
  const ids = new Map<string, RunId>();
  extraEndedCases.forEach((c, i) => {
    const at = 200 + i * 10;
    const id = assign(db, c.key, at);
    const end: RunStateChange = {
      to: "ended",
      agentResult: c.agentResult,
      prState: c.prState,
      runnerUnreached: c.runnerUnreached,
    };
    walk(db, id, at, c.started ? [startedOn(c.key), end] : [end]);
    ids.set(c.key, id);
  });
  return ids;
}
