import type { AgentResult, PrState, SummaryOutcome, TrackerStateCategory } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";

export type TicketRun =
  | {
      id: string;
      assignedAt: string;
      assignedAgoMs: number;
      state: "queued" | "running" | "waiting-for-input" | "disconnected";
    }
  | {
      id: string;
      assignedAt: string;
      assignedAgoMs: number;
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      summary: SummaryOutcome;
      prSettledLater: boolean;
    };

export interface AssignDefaults {
  runnerProject: string;
  agent: string;
}

export type Assignability =
  | { kind: "ready"; defaults: AssignDefaults }
  | { kind: "active-run"; runId: string }
  | { kind: "no-mapping" };

export interface TicketView {
  id: string;
  connection: string;
  key: string;
  title: string;
  url: string | null;
  trackerProject: { id: string; name: string };
  trackerState: { name: string; category: TrackerStateCategory };
  labels: ReadonlyArray<{ name: string; autoAssign: boolean }>;
  runs: ReadonlyArray<TicketRun>;
  assignability: Assignability;
}

export interface RunnerChoice {
  id: string;
  name: string;
  online: boolean;
  assignmentBlocked: boolean;
  projects: ReadonlyArray<string>;
}

export interface TrackerLoadError {
  trackerProject: string;
  reason:
    | "unauthorized"
    | "rate-limited"
    | "not-found"
    | "network"
    | "unknown-connection"
    | "failed";
}

export interface TrackerTruncation {
  trackerProject: string;
  limit: number;
}

export interface TicketsPage {
  workspace: WorkspaceChoice;
  tickets: TicketView[];
  runners: RunnerChoice[];
  agents: string[];
  errors: TrackerLoadError[];
  truncated: TrackerTruncation[];
  hasTrackerProjects: boolean;
}

export const TICKET_FILTERS = ["all", "attention", "unassigned", "running", "merged"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

export function lastRun(ticket: TicketView): TicketRun | undefined {
  return ticket.runs[0];
}

export function needsAttention(run: TicketRun): boolean {
  switch (run.state) {
    case "waiting-for-input":
    case "disconnected":
      return true;
    case "ended":
      return run.summary === "failed" || (run.summary === "human-check" && !run.prSettledLater);
    case "queued":
    case "running":
      return false;
  }
}

export function matchesFilter(ticket: TicketView, filter: TicketFilter): boolean {
  const run = lastRun(ticket);
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return run !== undefined && needsAttention(run);
    case "unassigned":
      return run === undefined;
    case "running":
      return run?.state === "running";
    case "merged":
      return run?.state === "ended" && run.summary === "merged";
  }
}

export function runnersFor(
  runners: ReadonlyArray<RunnerChoice>,
  runnerProject: string,
): RunnerChoice[] {
  return runners.filter((runner) => runner.projects.includes(runnerProject));
}

export function agentsFor(agents: ReadonlyArray<string>, defaultAgent: string): string[] {
  return [defaultAgent, ...agents.filter((agent) => agent !== defaultAgent)];
}
