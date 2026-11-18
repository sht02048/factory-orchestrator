import { randomUUID } from "node:crypto";
import {
  NOT_STARTED_AGENT_RESULTS,
  checkAssignment,
  checkManualRunnerChoice,
  pickRunner,
  toRunId,
  transitionRun,
} from "@ganger/core";
import type {
  AgentId,
  AgentRef,
  AgentResult,
  CiState,
  CommentId,
  InvalidRunTransition,
  NotStartedAgentResult,
  PrState,
  PullRequestId,
  Run,
  RunId,
  RunPlacement,
  RunState,
  RunnerId,
  RunnerProjectId,
  TicketRef,
  TrackerConnectionId,
  TrackerProjectId,
  WorktreeRef,
} from "@ganger/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import type { WorkspaceId } from "./ids.js";
import { runStateChanges, runs } from "./schema.js";
import type { LATER_PR_STATES } from "./schema.js";
import { getWorkspaceTrackerProject, listRunnerSnapshots } from "./settings.js";

export type StoredRun = Run & { workspaceId: WorkspaceId; ticketTitle: string | null };

export interface RunRecords {
  startRequestedAt: Date | null;
  startFailures: number;
  startError: string | null;
  reportBody: string | null;
  pullRequest: {
    id: PullRequestId;
    displayId: string;
    url: string;
    ci: CiState;
    checkedAt: Date;
  } | null;
  laterPrState: { state: (typeof LATER_PR_STATES)[number]; at: Date } | null;
  worktreeRemovedAt: Date | null;
  trackerStateSetAt: Date | null;
  trackerComment: { id: CommentId; at: Date } | null;
  unreachableSince: Date | null;
  lastLog: string[] | null;
}

export const LAST_LOG_LINES = 200;

type RunRow = typeof runs.$inferSelect;

export class RunRowError extends Error {
  constructor(runId: RunId, message: string) {
    super(`run ${runId}: ${message}`);
    this.name = "RunRowError";
  }
}

function toStoredRun(row: RunRow): StoredRun {
  const base = {
    id: row.id,
    workspaceId: row.workspaceId,
    ticket: { connection: row.trackerConnectionId, key: row.ticketKey },
    ticketTitle: row.ticketTitle,
    trackerProject: row.trackerProjectId,
    runnerProject: row.runnerProjectId,
    agent: row.agentId,
    model: row.model,
    worktreeName: row.worktreeName,
    assignedAt: row.assignedAt,
  };
  if (row.state === "queued") {
    return { ...base, state: row.state, runnerId: row.runnerId };
  }
  if (row.state === "ended" && row.startedAt === null) {
    const { endedAt, agentResult, prState } = row;
    if (endedAt === null || !isNotStartedResult(agentResult) || prState !== "none") {
      throw new RunRowError(row.id, "not-started ended run without end time or with started axes");
    }
    return {
      ...base,
      state: row.state,
      runnerId: row.runnerId,
      worktree: null,
      branch: null,
      agentRef: null,
      startedAt: null,
      endedAt,
      agentResult,
      prState,
      runnerUnreached: false,
    };
  }
  const { runnerId, worktreeRef: worktree, startedAt, branch, agentRef } = row;
  if (
    runnerId === null ||
    worktree === null ||
    startedAt === null ||
    branch === null ||
    agentRef === null
  ) {
    throw new RunRowError(
      row.id,
      `${row.state} run without runner, worktree, branch or start time`,
    );
  }
  const started = { runnerId, worktree, branch, agentRef, startedAt };
  if (row.state !== "ended") {
    return { ...base, ...started, state: row.state };
  }
  const { endedAt, agentResult, prState } = row;
  if (endedAt === null || agentResult === null || prState === null) {
    throw new RunRowError(row.id, "ended run without end time or the two axes");
  }
  return {
    ...base,
    ...started,
    state: row.state,
    endedAt,
    agentResult,
    prState,
    runnerUnreached: row.runnerUnreached,
  };
}

function isNotStartedResult(result: AgentResult | null): result is NotStartedAgentResult {
  return NOT_STARTED_AGENT_RESULTS.some((r) => r === result);
}

function toRunRecords(row: RunRow): RunRecords {
  return {
    startRequestedAt: row.startRequestedAt,
    startFailures: row.startFailures,
    startError: row.startError,
    reportBody: row.reportBody,
    pullRequest:
      row.prId === null || row.prCheckedAt === null
        ? null
        : {
            id: row.prId,
            displayId: row.prDisplayId ?? "",
            url: row.prUrl ?? "",
            ci: row.prCiState ?? "none",
            checkedAt: row.prCheckedAt,
          },
    laterPrState:
      row.laterPrState === null || row.laterPrStateAt === null
        ? null
        : { state: row.laterPrState, at: row.laterPrStateAt },
    worktreeRemovedAt: row.worktreeRemovedAt,
    trackerStateSetAt: row.trackerStateSetAt,
    trackerComment:
      row.trackerCommentId === null || row.trackerCommentedAt === null
        ? null
        : { id: row.trackerCommentId, at: row.trackerCommentedAt },
    unreachableSince: row.unreachableSince,
    lastLog: row.lastLog,
  };
}

function getRunRow(db: Database, id: RunId): RunRow | undefined {
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function getRun(db: Database, id: RunId): StoredRun | null {
  const row = getRunRow(db, id);
  return row === undefined ? null : toStoredRun(row);
}

export function getRunWithRecords(
  db: Database,
  id: RunId,
): { run: StoredRun; records: RunRecords } | null {
  const row = getRunRow(db, id);
  return row === undefined ? null : { run: toStoredRun(row), records: toRunRecords(row) };
}

export interface ListRunsFilter {
  states?: ReadonlyArray<RunState>;
  ticket?: TicketRef;
  workspaceId?: WorkspaceId;
  order?: "oldest" | "newest";
  limit?: number;
  latestPerTicket?: boolean;
  endedAxes?: ReadonlyArray<EndedAxesFilter>;
  runnerId?: RunnerId | null;
  trackerProject?: { connection: TrackerConnectionId; project: TrackerProjectId };
  agent?: AgentId;
  endedBetween?: { from: Date; before: Date };
}

export interface EndedAxesFilter {
  agentResult: AgentResult;
  prState: PrState;
  laterPrState?: null;
}

export function listRuns(db: Database, filter: ListRunsFilter = {}): StoredRun[] {
  return selectRunRows(db, filter).map(toStoredRun);
}

export function listRunsWithRecords(
  db: Database,
  filter: ListRunsFilter = {},
): Array<{ run: StoredRun; records: RunRecords }> {
  return selectRunRows(db, filter).map((row) => ({
    run: toStoredRun(row),
    records: toRunRecords(row),
  }));
}

function selectRunRows(db: Database, filter: ListRunsFilter): RunRow[] {
  if (filter.states?.length === 0 || filter.limit === 0 || filter.endedAxes?.length === 0)
    return [];
  const conditions: SQL[] = [];
  if (filter.states !== undefined) conditions.push(inArray(runs.state, [...filter.states]));
  if (filter.ticket !== undefined) {
    conditions.push(eq(runs.trackerConnectionId, filter.ticket.connection));
    conditions.push(eq(runs.ticketKey, filter.ticket.key));
  }
  if (filter.workspaceId !== undefined) conditions.push(eq(runs.workspaceId, filter.workspaceId));
  if (filter.runnerId !== undefined)
    conditions.push(
      filter.runnerId === null ? isNull(runs.runnerId) : eq(runs.runnerId, filter.runnerId),
    );
  if (filter.trackerProject !== undefined) {
    conditions.push(eq(runs.trackerConnectionId, filter.trackerProject.connection));
    conditions.push(eq(runs.trackerProjectId, filter.trackerProject.project));
  }
  if (filter.agent !== undefined) conditions.push(eq(runs.agentId, filter.agent));
  if (filter.endedBetween !== undefined) {
    conditions.push(gte(runs.endedAt, filter.endedBetween.from));
    conditions.push(lt(runs.endedAt, filter.endedBetween.before));
  }
  if (filter.latestPerTicket === true) {
    const newer = alias(runs, "newer_run");
    conditions.push(
      notExists(
        db
          .select({ id: newer.id })
          .from(newer)
          .where(
            and(
              eq(newer.trackerConnectionId, runs.trackerConnectionId),
              eq(newer.ticketKey, runs.ticketKey),
              filter.workspaceId === undefined
                ? undefined
                : eq(newer.workspaceId, runs.workspaceId),
              or(
                gt(newer.assignedAt, runs.assignedAt),
                and(eq(newer.assignedAt, runs.assignedAt), gt(newer.id, runs.id)),
              ),
            ),
          ),
      ),
    );
  }
  if (filter.endedAxes !== undefined) {
    conditions.push(
      or(
        ...filter.endedAxes.map((axes) =>
          and(
            eq(runs.state, "ended"),
            eq(runs.agentResult, axes.agentResult),
            eq(runs.prState, axes.prState),
            axes.laterPrState === null ? isNull(runs.laterPrState) : undefined,
          ),
        ),
      ) ?? sql`0`,
    );
  }
  const order =
    filter.order === "newest"
      ? [desc(runs.assignedAt), desc(runs.id)]
      : [asc(runs.assignedAt), asc(runs.id)];
  const query = db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(...order);
  return filter.limit === undefined ? query.all() : query.limit(filter.limit).all();
}

export function listRunPlacements(db: Database): RunPlacement[] {
  return db
    .select({ runnerId: runs.runnerId, state: runs.state })
    .from(runs)
    .where(ne(runs.state, "ended"))
    .all();
}

export interface AssignRunInput {
  ticket: TicketRef;
  ticketTitle?: string | null;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  model?: string | null;
  runnerId?: RunnerId;
  now?: Date;
}

export type AssignRunResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      reason:
        | "active-run"
        | "unknown-tracker-project"
        | "unknown-runner"
        | "runner-assignment-blocked";
    };

export function assignRun(db: Database, input: AssignRunInput): AssignRunResult {
  const now = input.now ?? new Date();
  return inTransaction(db, (): AssignRunResult => {
    const project = getWorkspaceTrackerProject(db, input.ticket.connection, input.trackerProject);
    if (project === null) return { ok: false, reason: "unknown-tracker-project" };

    const check = checkAssignment({
      ticket: input.ticket,
      runs: listRuns(db, { ticket: input.ticket }),
    });
    if (!check.ok) return { ok: false, reason: "active-run" };

    let runnerId: RunnerId | null;
    if (input.runnerId === undefined) {
      runnerId = pickRunner({
        project: input.runnerProject,
        runners: listRunnerSnapshots(db),
        runs: listRunPlacements(db),
      });
    } else {
      const chosen = listRunnerSnapshots(db).find((runner) => runner.id === input.runnerId);
      if (chosen === undefined) return { ok: false, reason: "unknown-runner" };
      if (!checkManualRunnerChoice(chosen).ok) {
        return { ok: false, reason: "runner-assignment-blocked" };
      }
      runnerId = input.runnerId;
    }

    const sameKeyRuns =
      db.select({ n: count() }).from(runs).where(eq(runs.ticketKey, input.ticket.key)).get()?.n ??
      0;
    const id = toRunId(randomUUID());
    db.insert(runs)
      .values({
        id,
        trackerConnectionId: input.ticket.connection,
        ticketKey: input.ticket.key,
        ticketTitle: storedTicketTitle(input.ticketTitle),
        workspaceId: project.workspaceId,
        trackerProjectId: input.trackerProject,
        runnerProjectId: input.runnerProject,
        agentId: input.agent,
        model: input.model ?? null,
        worktreeName: `ganger-${input.ticket.key}-${sameKeyRuns + 1}`,
        state: "queued",
        runnerId,
        assignedAt: now,
      })
      .run();
    recordStateChange(db, id, null, "queued", now);

    const run = getRun(db, id);
    if (run === null) throw new RunRowError(id, "missing right after insert");
    return { ok: true, run };
  });
}

export const TICKET_TITLE_MAX_LENGTH = 500;

export function storedTicketTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim().slice(0, TICKET_TITLE_MAX_LENGTH) ?? "";
  return trimmed === "" ? null : trimmed;
}

export function fillRunTicketTitle(db: Database, id: RunId, title: string): void {
  const stored = storedTicketTitle(title);
  if (stored === null) return;
  db.update(runs)
    .set({ ticketTitle: stored })
    .where(and(eq(runs.id, id), isNull(runs.ticketTitle)))
    .run();
}

export type RunStateChange =
  | { to: "running"; started?: { worktree: WorktreeRef; branch: string; agentRef: AgentRef } }
  | { to: "waiting-for-input" | "disconnected" }
  | {
      to: "ended";
      agentResult: AgentResult;
      prState: PrState;
      runnerUnreached?: boolean;
      reportBody?: string;
    };

export type ChangeRunStateResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      error:
        | InvalidRunTransition
        | { kind: "not-found" }
        | { kind: "no-runner" }
        | { kind: "no-worktree" }
        | { kind: "axes-mismatch" };
    };

export function changeRunState(
  db: Database,
  runId: RunId,
  change: RunStateChange,
  now: Date = new Date(),
): ChangeRunStateResult {
  return inTransaction(db, (): ChangeRunStateResult => {
    const current = getRun(db, runId);
    if (current === null) return { ok: false, error: { kind: "not-found" } };
    const transition = transitionRun(current.state, change.to);
    if (!transition.ok) return { ok: false, error: transition.error };

    const where = and(eq(runs.id, runId), eq(runs.state, current.state));
    if (change.to === "ended") {
      const notStarted = current.state === "queued";
      const runnerUnreached = change.runnerUnreached ?? false;
      const fits = notStarted
        ? isNotStartedResult(change.agentResult) && change.prState === "none" && !runnerUnreached
        : change.agentResult !== "could-not-start" &&
          (!runnerUnreached || change.agentResult === "canceled");
      if (!fits) return { ok: false, error: { kind: "axes-mismatch" } };
      db.update(runs)
        .set({
          state: "ended",
          endedAt: now,
          agentResult: change.agentResult,
          prState: change.prState,
          runnerUnreached,
          reportBody: change.reportBody ?? null,
        })
        .where(where)
        .run();
    } else if (current.state === "queued") {
      if (current.runnerId === null) return { ok: false, error: { kind: "no-runner" } };
      if (change.to !== "running" || change.started === undefined) {
        return { ok: false, error: { kind: "no-worktree" } };
      }
      const { worktree, branch, agentRef } = change.started;
      db.update(runs)
        .set({ state: "running", startedAt: now, worktreeRef: worktree, branch, agentRef })
        .where(where)
        .run();
    } else {
      db.update(runs).set({ state: change.to }).where(where).run();
    }
    recordStateChange(db, runId, current.state, change.to, now);

    const run = getRun(db, runId);
    if (run === null) throw new RunRowError(runId, "missing right after update");
    return { ok: true, run };
  });
}

export function recordStartRequested(db: Database, runId: RunId, now: Date = new Date()): boolean {
  return (
    db
      .update(runs)
      .set({ startRequestedAt: now })
      .where(and(eq(runs.id, runId), eq(runs.state, "queued"), isNull(runs.startRequestedAt)))
      .run().changes > 0
  );
}

export function clearStartRequested(db: Database, runId: RunId): boolean {
  return (
    db
      .update(runs)
      .set({ startRequestedAt: null })
      .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
      .run().changes > 0
  );
}

export function recordStartFailure(
  db: Database,
  runId: RunId,
  input: { failures: number; error: string },
): boolean {
  return (
    db
      .update(runs)
      .set({ startFailures: input.failures, startError: input.error })
      .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
      .run().changes > 0
  );
}

export function setQueuedRunRunner(db: Database, runId: RunId, runnerId: RunnerId | null): boolean {
  const result = db
    .update(runs)
    .set({ runnerId })
    .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
    .run();
  return result.changes > 0;
}

function recordStateChange(
  db: Database,
  runId: RunId,
  from: RunState | null,
  to: RunState,
  now: Date,
): void {
  db.insert(runStateChanges).values({ runId, fromState: from, toState: to, changedAt: now }).run();
}

export interface RunStateChangeRecord {
  from: RunState | null;
  to: RunState;
  at: Date;
}

export function listRunStateChanges(db: Database, runId: RunId): RunStateChangeRecord[] {
  return db
    .select({
      from: runStateChanges.fromState,
      to: runStateChanges.toState,
      at: runStateChanges.changedAt,
    })
    .from(runStateChanges)
    .where(eq(runStateChanges.runId, runId))
    .orderBy(asc(runStateChanges.id))
    .all();
}

export function updateRunRecords(
  db: Database,
  runId: RunId,
  patch: Partial<
    Omit<RunRecords, "startRequestedAt" | "startFailures" | "startError" | "reportBody">
  >,
): boolean {
  const set: Partial<typeof runs.$inferInsert> = {};
  if (patch.pullRequest !== undefined) {
    const pr = patch.pullRequest;
    set.prId = pr?.id ?? null;
    set.prDisplayId = pr?.displayId ?? null;
    set.prUrl = pr?.url ?? null;
    set.prCiState = pr?.ci ?? null;
    set.prCheckedAt = pr?.checkedAt ?? null;
  }
  if (patch.laterPrState !== undefined) {
    set.laterPrState = patch.laterPrState?.state ?? null;
    set.laterPrStateAt = patch.laterPrState?.at ?? null;
  }
  if (patch.worktreeRemovedAt !== undefined) set.worktreeRemovedAt = patch.worktreeRemovedAt;
  if (patch.trackerStateSetAt !== undefined) set.trackerStateSetAt = patch.trackerStateSetAt;
  if (patch.trackerComment !== undefined) {
    set.trackerCommentId = patch.trackerComment?.id ?? null;
    set.trackerCommentedAt = patch.trackerComment?.at ?? null;
  }
  if (patch.unreachableSince !== undefined) set.unreachableSince = patch.unreachableSince;
  if (patch.lastLog !== undefined) {
    set.lastLog = patch.lastLog === null ? null : patch.lastLog.slice(-LAST_LOG_LINES);
  }
  if (Object.keys(set).length === 0) return false;

  return db.update(runs).set(set).where(eq(runs.id, runId)).run().changes > 0;
}
