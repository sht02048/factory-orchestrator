import type {
  AgentId,
  AgentRef,
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
} from "@ganger/core";
import type { runStateChanges, runs } from "./schema.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type RunRow = typeof runs.$inferSelect;
type EndedRun = Extract<Run, { state: "ended" }>;

export type SchemaMatchesCore = [
  Assert<Equals<RunRow["state"], RunState>>,
  Assert<Equals<RunRow["agentResult"], AgentResult | null>>,
  Assert<Equals<RunRow["prState"], PrState | null>>,
  Assert<Equals<NonNullable<RunRow["agentResult"]>, EndedRun["agentResult"]>>,
  Assert<Equals<NonNullable<RunRow["prState"]>, EndedRun["prState"]>>,
  Assert<Equals<(typeof runStateChanges.$inferSelect)["toState"], RunState>>,
  Assert<Equals<RunRow["id"], RunId>>,
  Assert<Equals<RunRow["trackerConnectionId"], TrackerConnectionId>>,
  Assert<Equals<RunRow["ticketKey"], TicketKey>>,
  Assert<Equals<RunRow["trackerProjectId"], TrackerProjectId>>,
  Assert<Equals<RunRow["runnerProjectId"], RunnerProjectId>>,
  Assert<Equals<RunRow["agentId"], AgentId>>,
  Assert<Equals<RunRow["runnerId"], RunnerId | null>>,
  Assert<Equals<RunRow["worktreeRef"], WorktreeRef | null>>,
  Assert<Equals<RunRow["agentRef"], AgentRef | null>>,
  Assert<Equals<RunRow["worktreeName"], Run["worktreeName"]>>,
  Assert<Equals<RunRow["branch"], EndedRun["branch"]>>,
  Assert<Equals<RunRow["runnerUnreached"], EndedRun["runnerUnreached"]>>,
  Assert<Equals<RunRow["assignedAt"], Date>>,
  Assert<Equals<RunRow["startedAt"], Date | null>>,
  Assert<Equals<Pick<RunRow, "runnerId" | "state">, RunPlacement>>,
];
