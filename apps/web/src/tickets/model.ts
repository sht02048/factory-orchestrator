import type { AgentResult, PrState, SummaryOutcome, TrackerStateCategory } from "@factory/core";
import type { WorkspaceChoice } from "../shell/model";

export type TicketRun =
  | {
      id: string;
      runnerName: string | null;
      state: "queued" | "running" | "waiting-for-input" | "disconnected";
      elapsedMs: number;
    }
  | {
      id: string;
      runnerName: string | null;
      state: "ended";
      endedAt: string;
      endedAgoMs: number;
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
  mapping: AssignDefaults | null;
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
  trackerProjectCount: number;
}

export const TICKET_FILTERS = ["all", "assignable", "todo", "in-progress", "done"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

export function lastRun(ticket: TicketView): TicketRun | undefined {
  return ticket.runs[0];
}

export function isTodo(run: TicketRun): boolean {
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

function isDone(run: TicketRun): boolean {
  if (run.state !== "ended") return false;
  switch (run.summary) {
    case "merged":
    case "canceled":
      return true;
    case "human-check":
      return run.prSettledLater;
    case "failed":
      return false;
  }
}

export function matchesFilter(ticket: TicketView, filter: TicketFilter): boolean {
  const run = lastRun(ticket);
  switch (filter) {
    case "all":
      return true;
    case "assignable":
      return (
        run === undefined ||
        (run.state === "ended" && (run.summary === "failed" || run.summary === "canceled"))
      );
    case "todo":
      return run !== undefined && isTodo(run);
    case "in-progress":
      return run?.state === "queued" || run?.state === "running";
    case "done":
      return run !== undefined && isDone(run);
  }
}

export function matchesSearch(ticket: TicketView, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return (
    ticket.key.toLocaleLowerCase().includes(needle) ||
    ticket.title.toLocaleLowerCase().includes(needle)
  );
}

export function countByFilter(tickets: ReadonlyArray<TicketView>): Record<TicketFilter, number> {
  const counts: Record<TicketFilter, number> = {
    all: 0,
    assignable: 0,
    todo: 0,
    "in-progress": 0,
    done: 0,
  };
  for (const ticket of tickets) {
    for (const key of TICKET_FILTERS) if (matchesFilter(ticket, key)) counts[key] += 1;
  }
  return counts;
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
