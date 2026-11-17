/**
 * Drizzle 추론 타입이 core 타입과 같은지 컴파일 타임에 확인한다. 런타임 코드는 없다.
 * 스키마 컬럼이나 core 타입 한쪽만 바뀌면 typecheck가 여기서 실패한다.
 */
import type {
  AgentId,
  AgentResult,
  PrState,
  Run,
  RunId,
  RunPlacement,
  RunState,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerProjectId,
  WorktreeRef,
} from "@factory/core";
import type { runStateChanges, runs } from "./schema.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type RunRow = typeof runs.$inferSelect;
type EndedRun = Extract<Run, { state: "ended" }>;

export type SchemaMatchesCore = [
  // 상태와 두 축은 core 열거 그대로다.
  Assert<Equals<RunRow["state"], RunState>>,
  Assert<Equals<RunRow["agentResult"], AgentResult | null>>,
  Assert<Equals<RunRow["prState"], PrState | null>>,
  Assert<Equals<NonNullable<RunRow["agentResult"]>, EndedRun["agentResult"]>>,
  Assert<Equals<NonNullable<RunRow["prState"]>, EndedRun["prState"]>>,
  Assert<Equals<(typeof runStateChanges.$inferSelect)["toState"], RunState>>,
  // ID는 core branded type이다(CODING_STANDARDS 「ID는 branded type으로 쓴다」).
  Assert<Equals<RunRow["id"], RunId>>,
  Assert<Equals<RunRow["trackerConnectionId"], TrackerConnectionId>>,
  Assert<Equals<RunRow["ticketKey"], TicketKey>>,
  Assert<Equals<RunRow["trackerProjectId"], TrackerProjectId>>,
  Assert<Equals<RunRow["runnerProjectId"], RunnerProjectId>>,
  Assert<Equals<RunRow["agentId"], AgentId>>,
  Assert<Equals<RunRow["runnerId"], RunnerId | null>>,
  Assert<Equals<RunRow["worktreeRef"], WorktreeRef | null>>,
  // 시각은 Date로 읽힌다.
  Assert<Equals<RunRow["assignedAt"], Date>>,
  Assert<Equals<RunRow["startedAt"], Date | null>>,
  // core 대기열 판단에 넘기는 모양을 그대로 고를 수 있다.
  Assert<Equals<Pick<RunRow, "runnerId" | "state">, RunPlacement>>,
];
