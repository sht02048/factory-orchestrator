import { AdapterError, checkAssignment, summarizeRunOutcome } from "@ganger/core";
import type {
  AdapterRegistry,
  LabelId,
  RunnerId,
  Tracker,
  TrackerConnectionId,
  TrackerTicket,
} from "@ganger/core";
import {
  getAutoAssignLabel,
  getMapping,
  getRunWithRecords,
  getTrackerConnection,
  listRunners,
  listRuns,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, SecretBox, StoredRun, StoredWorkspaceTrackerProject } from "@ganger/db";
import { z } from "zod";
import { isWebUrl } from "../format/url";
import { resolveWorkspace } from "../shell/model";
import type {
  AssignDefaults,
  TicketRun,
  TicketView,
  TicketsPage,
  TrackerLoadError,
  TrackerTruncation,
} from "./model";

export interface TicketsContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

export const PAGE_SIZE = 250;
export const MAX_PAGES = 4;

export async function loadTicketsPage(
  context: TicketsContext,
  ws: string | undefined,
  now: Date,
): Promise<TicketsPage> {
  const { db } = context;
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  const storedRunners = listRunners(db);
  const runners = storedRunners.map((runner) => ({
    id: runner.id,
    name: runner.name,
    online: runner.online,
    assignmentBlocked: runner.assignmentBlocked,
    projects: runner.projects.map((p) => p.id),
  }));
  const agents = mappingAgents(db);
  const runnerNames = new Map(storedRunners.map((runner) => [runner.id, runner.name]));
  if (workspace.kind !== "one")
    return {
      workspace,
      tickets: [],
      runners,
      agents,
      errors: [],
      truncated: [],
      trackerProjectCount: 0,
    };

  const workspaceId = toWorkspaceId(workspace.workspace.id);
  const projects = listWorkspaceTrackerProjects(db, workspaceId);
  const runsByTicket = groupRuns(listRuns(db, { workspaceId }));

  const trackers = new Map<TrackerConnectionId, Tracker | null>();
  const trackerOf = (connection: TrackerConnectionId): Tracker | null => {
    let tracker = trackers.get(connection);
    if (tracker === undefined) {
      const stored = getTrackerConnection(db, context.secretBox, connection);
      tracker =
        stored === null
          ? null
          : context.registry.createTracker(stored.kind, {
              config: stored.config,
              secrets: stored.secrets,
            });
      trackers.set(connection, tracker);
    }
    return tracker;
  };

  const errors: TrackerLoadError[] = [];
  const truncated: TrackerTruncation[] = [];
  const results = await Promise.all(
    projects.map(async (project) => {
      try {
        const tracker = trackerOf(project.connection);
        if (tracker === null) {
          errors.push({ trackerProject: project.name, reason: "unknown-connection" });
          return [];
        }
        const { tickets, more } = await readProjectTickets(tracker, project);
        if (more) truncated.push({ trackerProject: project.name, limit: tickets.length });
        return tickets.map((ticket) => ({ project, ticket }));
      } catch (error) {
        errors.push({ trackerProject: project.name, reason: loadErrorReason(error) });
        return [];
      }
    }),
  );

  const autoAssignLabels = new Map<TrackerConnectionId, LabelId | null>();
  const autoAssignLabelOf = (connection: TrackerConnectionId): LabelId | null => {
    let label = autoAssignLabels.get(connection);
    if (label === undefined) {
      label = getAutoAssignLabel(db, workspaceId, connection);
      autoAssignLabels.set(connection, label);
    }
    return label;
  };

  const tickets = results
    .flat()
    .toSorted((a, b) => b.ticket.updatedAt.getTime() - a.ticket.updatedAt.getTime())
    .map(({ project, ticket }): TicketView => {
      const id = ticketId(project.connection, ticket.key);
      const runs = runsByTicket.get(id) ?? [];
      const autoAssign = autoAssignLabelOf(project.connection);
      return {
        id,
        connection: project.connection,
        key: ticket.key,
        title: ticket.title,
        url: isWebUrl(ticket.url) ? ticket.url : null,
        trackerProject: { id: project.projectId, name: project.name },
        trackerState: { name: ticket.state.name, category: ticket.state.category },
        labels: ticket.labels.map((label) => ({
          name: label.name,
          autoAssign: label.id === autoAssign,
        })),
        runs: runs.toReversed().map((run) => toTicketRun(db, run, runnerNames, now)),
        mapping: mappingOf(db, project),
        assignability: assignabilityOf(db, project, ticket, runs),
      };
    });

  errors.sort((a, b) => a.trackerProject.localeCompare(b.trackerProject));
  truncated.sort((a, b) => a.trackerProject.localeCompare(b.trackerProject));
  return {
    workspace,
    tickets,
    runners,
    agents,
    errors,
    truncated,
    trackerProjectCount: projects.length,
  };
}

export function ticketId(connection: string, key: string): string {
  return JSON.stringify([connection, key]);
}

async function readProjectTickets(
  tracker: Tracker,
  project: StoredWorkspaceTrackerProject,
): Promise<{ tickets: TrackerTicket[]; more: boolean }> {
  const tickets: TrackerTicket[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await tracker.listProjectTickets(project.projectId, {
      first: PAGE_SIZE,
      ...(after === null ? {} : { after }),
    });
    tickets.push(...result.items);
    after = result.nextCursor;
    if (after === null) break;
  }
  return { tickets, more: after !== null };
}

const adapterErrorSchema = z.object({ kind: z.string() });

function loadErrorReason(error: unknown): TrackerLoadError["reason"] {
  if (!(error instanceof AdapterError)) return "failed";
  const detail: unknown = error.detail;
  const parsed = adapterErrorSchema.safeParse(detail);
  if (!parsed.success) return "failed";
  const { kind } = parsed.data;
  switch (kind) {
    case "unauthorized":
    case "rate-limited":
    case "not-found":
    case "network":
      return kind;
    default:
      return "failed";
  }
}

function groupRuns(runs: ReadonlyArray<StoredRun>): Map<string, StoredRun[]> {
  const byTicket = new Map<string, StoredRun[]>();
  for (const run of runs) {
    const id = ticketId(run.ticket.connection, run.ticket.key);
    const list = byTicket.get(id);
    if (list === undefined) byTicket.set(id, [run]);
    else list.push(run);
  }
  return byTicket;
}

function toTicketRun(
  db: Database,
  run: StoredRun,
  runnerNames: ReadonlyMap<RunnerId, string>,
  now: Date,
): TicketRun {
  const runnerName = run.runnerId === null ? null : (runnerNames.get(run.runnerId) ?? null);
  if (run.state !== "ended")
    return {
      id: run.id,
      runnerName,
      state: run.state,
      elapsedMs: msSince(run.state === "queued" ? run.assignedAt : run.startedAt, now),
    };
  return {
    id: run.id,
    runnerName,
    state: run.state,
    endedAt: run.endedAt.toISOString(),
    endedAgoMs: msSince(run.endedAt, now),
    agentResult: run.agentResult,
    prState: run.prState,
    summary: summarizeRunOutcome(run).outcome,
    prSettledLater: (getRunWithRecords(db, run.id)?.records.laterPrState ?? null) !== null,
  };
}

function msSince(at: Date, now: Date): number {
  return Math.max(0, now.getTime() - at.getTime());
}

function assignabilityOf(
  db: Database,
  project: StoredWorkspaceTrackerProject,
  ticket: TrackerTicket,
  runs: ReadonlyArray<StoredRun>,
): TicketView["assignability"] {
  const check = checkAssignment({
    ticket: { connection: project.connection, key: ticket.key },
    runs,
  });
  if (!check.ok) {
    const active = runs.findLast((run) => run.state !== "ended");
    return { kind: "active-run", runId: active?.id ?? "" };
  }
  const mapping = mappingOf(db, project);
  if (mapping === null) return { kind: "no-mapping" };
  return { kind: "ready", defaults: mapping };
}

function mappingOf(db: Database, project: StoredWorkspaceTrackerProject): AssignDefaults | null {
  const mapping = getMapping(db, project.connection, project.projectId);
  return mapping === null ? null : { runnerProject: mapping.runnerProject, agent: mapping.agent };
}

function mappingAgents(db: Database): string[] {
  const agents = new Set<string>();
  for (const project of listWorkspaceTrackerProjects(db)) {
    const mapping = getMapping(db, project.connection, project.projectId);
    if (mapping !== null) agents.add(mapping.agent);
  }
  return [...agents].toSorted();
}
