import type {
  AgentResult,
  DeliveryId,
  PermissionRequestId,
  PrState,
  QuestionId,
  RunControl,
  RunId,
  RunnerId,
  RunState,
  TicketKey,
  TrackerConnectionId,
} from "@ganger/core";
import { and, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "./database.js";
import type { WorkspaceId } from "./ids.js";
import type { McpActionOutcome } from "./mcp-actions-model.js";
import type { NotificationEventKind } from "./notification-events-model.js";
import {
  mcpActions,
  notificationEvents,
  runCancelRequests,
  runControlRequests,
  runPermissionWaits,
  runQuestions,
  runs,
  runStateChanges,
  trackerEvents,
} from "./schema.js";

export interface TimelineRun {
  id: RunId;
  ticketKey: TicketKey;
  trackerConnectionId: TrackerConnectionId;
  workspaceId: WorkspaceId;
  runnerId: RunnerId | null;
  worktreeName: string;
  state: RunState;
  agentResult: AgentResult | null;
  startFailures: number;
  startError: string | null;
}

export type RunTimelineEntry =
  | {
      at: Date;
      source: "run";
      runId: RunId;
      event: "assigned" | "start-requested" | "started" | "unreachable" | "paused" | "ended";
      agentResult?: AgentResult;
      prState?: PrState;
    }
  | { at: Date; source: "state"; runId: RunId; from: RunState | null; to: RunState }
  | {
      at: Date;
      source: "tracker";
      runId: null;
      deliveryId: DeliveryId;
      kind: string;
      processedAt: Date | null;
    }
  | {
      at: Date;
      source: "mcp";
      runId: RunId;
      client: string;
      tool: string;
      outcome: McpActionOutcome;
      reason: string | null;
    }
  | {
      at: Date;
      source: "notification";
      runId: RunId;
      kind: NotificationEventKind;
      resolvedAt: Date | null;
    }
  | {
      at: Date;
      source: "question";
      runId: RunId;
      event: "asked" | "answered" | "answer-sent";
      questionId: QuestionId;
    }
  | {
      at: Date;
      source: "permission";
      runId: RunId;
      event: "requested" | "denied" | "resolved";
      permissionId: PermissionRequestId;
    }
  | { at: Date; source: "cancel"; runId: RunId; event: "requested" | "processed" }
  | {
      at: Date;
      source: "control";
      runId: RunId;
      event: "requested" | "completed";
      control: RunControl;
    };

export interface RunTimeline {
  runs: TimelineRun[];
  entries: RunTimelineEntry[];
}

export function runTimeline(db: Database, runId: RunId): RunTimeline | null {
  const found = selectRuns(db, eq(runs.id, runId));
  const run = found[0];
  if (run === undefined) return null;
  return timelineOf(
    db,
    found,
    and(
      eq(trackerEvents.trackerConnectionId, run.trackerConnectionId),
      eq(trackerEvents.ticketKey, run.ticketKey),
    ),
  );
}

export function ticketTimeline(db: Database, ticketKey: TicketKey): RunTimeline {
  return timelineOf(
    db,
    selectRuns(db, eq(runs.ticketKey, ticketKey)),
    eq(trackerEvents.ticketKey, ticketKey),
  );
}

function selectRuns(db: Database, where: SQL): Array<TimelineRun & RunTimes> {
  return db
    .select({
      id: runs.id,
      ticketKey: runs.ticketKey,
      trackerConnectionId: runs.trackerConnectionId,
      workspaceId: runs.workspaceId,
      runnerId: runs.runnerId,
      worktreeName: runs.worktreeName,
      state: runs.state,
      agentResult: runs.agentResult,
      prState: runs.prState,
      startFailures: runs.startFailures,
      startError: runs.startError,
      assignedAt: runs.assignedAt,
      startRequestedAt: runs.startRequestedAt,
      startedAt: runs.startedAt,
      unreachableSince: runs.unreachableSince,
      pausedSince: runs.pausedSince,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .where(where)
    .orderBy(runs.assignedAt, runs.id)
    .all();
}

interface RunTimes {
  prState: PrState | null;
  assignedAt: Date;
  startRequestedAt: Date | null;
  startedAt: Date | null;
  unreachableSince: Date | null;
  pausedSince: Date | null;
  endedAt: Date | null;
}

function timelineOf(
  db: Database,
  found: ReadonlyArray<TimelineRun & RunTimes>,
  trackerWhere: SQL | undefined,
): RunTimeline {
  const entries: RunTimelineEntry[] = [];
  for (const run of found) entries.push(...runEntries(run));
  const ids = found.map((run) => run.id);
  if (ids.length > 0) {
    for (const change of db
      .select()
      .from(runStateChanges)
      .where(inArray(runStateChanges.runId, ids))
      .orderBy(runStateChanges.id)
      .all()) {
      entries.push({
        at: change.changedAt,
        source: "state",
        runId: change.runId,
        from: change.fromState,
        to: change.toState,
      });
    }
  }
  for (const event of db
    .select()
    .from(trackerEvents)
    .where(trackerWhere)
    .orderBy(trackerEvents.receivedAt)
    .all()) {
    entries.push({
      at: event.receivedAt,
      source: "tracker",
      runId: null,
      deliveryId: event.deliveryId,
      kind: event.kind,
      processedAt: event.processedAt,
    });
  }
  if (ids.length > 0) entries.push(...runRecordEntries(db, ids));
  return {
    runs: found.map(summary),
    entries: inTimeOrder(entries),
  };
}

function summary(run: TimelineRun & RunTimes): TimelineRun {
  return {
    id: run.id,
    ticketKey: run.ticketKey,
    trackerConnectionId: run.trackerConnectionId,
    workspaceId: run.workspaceId,
    runnerId: run.runnerId,
    worktreeName: run.worktreeName,
    state: run.state,
    agentResult: run.agentResult,
    startFailures: run.startFailures,
    startError: run.startError,
  };
}

function runEntries(run: TimelineRun & RunTimes): RunTimelineEntry[] {
  const entries: RunTimelineEntry[] = [
    { at: run.assignedAt, source: "run", runId: run.id, event: "assigned" },
  ];
  const moment = (
    at: Date | null,
    event: "start-requested" | "started" | "unreachable" | "paused",
  ) => {
    if (at !== null) entries.push({ at, source: "run", runId: run.id, event });
  };
  moment(run.startRequestedAt, "start-requested");
  moment(run.startedAt, "started");
  moment(run.unreachableSince, "unreachable");
  moment(run.pausedSince, "paused");
  if (run.endedAt !== null) {
    entries.push({
      at: run.endedAt,
      source: "run",
      runId: run.id,
      event: "ended",
      ...(run.agentResult === null ? {} : { agentResult: run.agentResult }),
      ...(run.prState === null ? {} : { prState: run.prState }),
    });
  }
  return entries;
}

function runRecordEntries(db: Database, ids: ReadonlyArray<RunId>): RunTimelineEntry[] {
  const entries: RunTimelineEntry[] = [];
  for (const action of db
    .select()
    .from(mcpActions)
    .where(inArray(mcpActions.runId, [...ids]))
    .orderBy(mcpActions.at, mcpActions.id)
    .all()) {
    if (action.runId === null) continue;
    entries.push({
      at: action.at,
      source: "mcp",
      runId: action.runId,
      client: action.client,
      tool: action.tool,
      outcome: action.outcome,
      reason: action.reason,
    });
  }
  for (const event of db
    .select()
    .from(notificationEvents)
    .where(inArray(notificationEvents.runId, [...ids]))
    .orderBy(notificationEvents.createdAt, notificationEvents.id)
    .all()) {
    if (event.runId === null) continue;
    entries.push({
      at: event.createdAt,
      source: "notification",
      runId: event.runId,
      kind: event.kind,
      resolvedAt: event.resolvedAt,
    });
  }
  for (const question of db
    .select()
    .from(runQuestions)
    .where(inArray(runQuestions.runId, [...ids]))
    .all()) {
    const base = {
      source: "question",
      runId: question.runId,
      questionId: question.questionId,
    } as const;
    entries.push({ ...base, at: question.askedAt, event: "asked" });
    if (question.answeredAt !== null) {
      entries.push({ ...base, at: question.answeredAt, event: "answered" });
    }
    if (question.answerSentAt !== null) {
      entries.push({ ...base, at: question.answerSentAt, event: "answer-sent" });
    }
  }
  for (const wait of db
    .select()
    .from(runPermissionWaits)
    .where(inArray(runPermissionWaits.runId, [...ids]))
    .all()) {
    const base = {
      source: "permission",
      runId: wait.runId,
      permissionId: wait.permissionId,
    } as const;
    entries.push({ ...base, at: wait.requestedAt, event: "requested" });
    if (wait.deniedAt !== null) entries.push({ ...base, at: wait.deniedAt, event: "denied" });
    if (wait.resolvedAt !== null) entries.push({ ...base, at: wait.resolvedAt, event: "resolved" });
  }
  for (const cancel of db
    .select()
    .from(runCancelRequests)
    .where(inArray(runCancelRequests.runId, [...ids]))
    .all()) {
    entries.push({
      at: cancel.requestedAt,
      source: "cancel",
      runId: cancel.runId,
      event: "requested",
    });
    if (cancel.processedAt !== null) {
      entries.push({
        at: cancel.processedAt,
        source: "cancel",
        runId: cancel.runId,
        event: "processed",
      });
    }
  }
  for (const control of db
    .select()
    .from(runControlRequests)
    .where(inArray(runControlRequests.runId, [...ids]))
    .all()) {
    const base = { source: "control", runId: control.runId, control: control.control } as const;
    entries.push({ ...base, at: control.requestedAt, event: "requested" });
    if (control.completedAt !== null) {
      entries.push({ ...base, at: control.completedAt, event: "completed" });
    }
  }
  return entries;
}

function inTimeOrder(entries: RunTimelineEntry[]): RunTimelineEntry[] {
  return entries
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.at.getTime() - b.entry.at.getTime() || a.order - b.order)
    .map(({ entry }) => entry);
}
