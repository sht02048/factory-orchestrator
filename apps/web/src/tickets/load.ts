import { AdapterError, checkAssignment, summarizeRunOutcome } from "@factory/core";
import type {
  AdapterRegistry,
  LabelId,
  Tracker,
  TrackerConnectionId,
  TrackerTicket,
} from "@factory/core";
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
} from "@factory/db";
import type { Database, SecretBox, StoredRun, StoredWorkspaceTrackerProject } from "@factory/db";
import { z } from "zod";
import { isWebUrl } from "../format/url";
import { resolveWorkspace } from "../shell/model";
import type { TicketRun, TicketView, TicketsPage, TrackerLoadError } from "./model";

export interface TicketsContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

/** 트래커 프로젝트 하나에서 읽는 쪽 크기와 쪽수. 250 은 Linear 상한이다(research 0005 12절) */
const PAGE_SIZE = 250;
const MAX_PAGES = 4;

/**
 * Tickets 화면이 보일 값을 읽는다. 티켓은 현재 Workspace 에 묶인 트래커 프로젝트마다 그 트래커 연결의
 * 어댑터로 조회하고(0027 의 AdapterRegistry, web 은 ssh 를 쓰지 않는다 Q61), 런은 DB 에서 읽는다.
 * 요약 결과는 저장하지 않으므로 core summarizeRunOutcome 으로 계산한다(Q66·Q76).
 *
 * `now` 는 서버가 읽은 때다. 런 이력의 상대 시간("25분 전")을 여기서 정한다.
 *
 * 한 트래커 프로젝트를 읽지 못해도 나머지는 보이고, 읽지 못한 것은 errors 에 담는다.
 */
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
  const runners = listRunners(db).map((runner) => ({
    id: runner.id,
    name: runner.name,
    online: runner.online,
    assignmentBlocked: runner.assignmentBlocked,
    projects: runner.projects.map((p) => p.id),
  }));
  const agents = mappingAgents(db);
  if (workspace.kind !== "one")
    return { workspace, tickets: [], runners, agents, errors: [], hasTrackerProjects: false };

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
  const results = await Promise.all(
    projects.map(async (project) => {
      try {
        const tracker = trackerOf(project.connection);
        if (tracker === null) {
          errors.push({ trackerProject: project.name, reason: "unknown-connection" });
          return [];
        }
        const tickets = await readProjectTickets(tracker, project);
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
        runs: runs.toReversed().map((run) => toTicketRun(db, run, now)),
        assignability: assignabilityOf(db, project, ticket, runs),
      };
    });

  errors.sort((a, b) => a.trackerProject.localeCompare(b.trackerProject));
  return { workspace, tickets, runners, agents, errors, hasTrackerProjects: projects.length > 0 };
}

/** 트래커 연결과 티켓 키로 만든 티켓 식별값. 다른 연결의 같은 키는 다른 티켓이다 */
export function ticketId(connection: string, key: string): string {
  return `${connection}\u0000${key}`;
}

async function readProjectTickets(
  tracker: Tracker,
  project: StoredWorkspaceTrackerProject,
): Promise<TrackerTicket[]> {
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
  return tickets;
}

/** 어댑터 오류의 종류. detail 은 어댑터마다 다른 모양이라 kind 만 읽는다 */
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

/** 할당 순서(오래된 것부터)를 지킨 채 티켓마다 묶는다 */
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

function toTicketRun(db: Database, run: StoredRun, now: Date): TicketRun {
  const assignedAt = run.assignedAt.toISOString();
  const assignedAgoMs = Math.max(0, now.getTime() - run.assignedAt.getTime());
  if (run.state !== "ended") return { id: run.id, assignedAt, assignedAgoMs, state: run.state };
  return {
    id: run.id,
    assignedAt,
    assignedAgoMs,
    state: run.state,
    agentResult: run.agentResult,
    prState: run.prState,
    summary: summarizeRunOutcome(run).outcome,
    prSettledLater: (getRunWithRecords(db, run.id)?.records.laterPrState ?? null) !== null,
  };
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
  const mapping = getMapping(db, project.connection, project.projectId);
  if (mapping === null) return { kind: "no-mapping" };
  return {
    kind: "ready",
    defaults: { runnerProject: mapping.runnerProject, agent: mapping.agent },
  };
}

/**
 * 할당 창의 에이전트 선택지: 설치의 모든 Mapping 에 쓰인 에이전트. 에이전트 목록을 주는 계약이 아직 없어
 * Mapping 에서 모은다(코디네이터 결정). 이름순.
 */
function mappingAgents(db: Database): string[] {
  const agents = new Set<string>();
  for (const project of listWorkspaceTrackerProjects(db)) {
    const mapping = getMapping(db, project.connection, project.projectId);
    if (mapping !== null) agents.add(mapping.agent);
  }
  return [...agents].toSorted();
}
