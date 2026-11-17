import { randomUUID } from "node:crypto";
import { checkAssignment, pickRunner, toRunId, transitionRun } from "@factory/core";
import type {
  AgentId,
  AgentResult,
  CiState,
  CommentId,
  InvalidRunTransition,
  PrState,
  PullRequestId,
  RetryToken,
  Run,
  RunId,
  RunPlacement,
  RunState,
  RunnerId,
  RunnerProjectId,
  TicketRef,
  TrackerProjectId,
  WorktreeRef,
} from "@factory/core";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import type { WorkspaceId } from "./ids.js";
import { runStateChanges, runners, runs } from "./schema.js";
import type { LATER_PR_STATES } from "./schema.js";
import { getWorkspaceTrackerProject, listRunnerSnapshots } from "./settings.js";

/** 저장한 런. core Run에 Workspace를 더한다. */
export type StoredRun = Run & { workspaceId: WorkspaceId };

/** 런 상태와 두 축 밖의 기록. 뒤 티켓의 worker·web이 쓰고 읽는다. */
export interface RunRecords {
  retryToken: RetryToken | null;
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

/** 런이 끝날 때 저장하는 로그 줄 수(Q46) */
export const LAST_LOG_LINES = 200;

type RunRow = typeof runs.$inferSelect;

/** DB의 런 행이 core Run 모양을 지키지 않음. CHECK 제약이 막으므로 생기면 버그다. */
export class RunRowError extends Error {
  constructor(runId: RunId, message: string) {
    super(`run ${runId}: ${message}`);
    this.name = "RunRowError";
  }
}

/**
 * 행을 core Run으로 바꾼다. 컬럼 타입은 Drizzle 추론 타입이 이미 core 타입이고(schema-types.ts),
 * 상태마다 어느 값이 있어야 하는지만 여기서 확인한다(타입이 표현하지 못하는 행 사이 조건).
 */
function toStoredRun(row: RunRow): StoredRun {
  const base = {
    id: row.id,
    workspaceId: row.workspaceId,
    ticket: { connection: row.trackerConnectionId, key: row.ticketKey },
    trackerProject: row.trackerProjectId,
    runnerProject: row.runnerProjectId,
    agent: row.agentId,
    branch: row.branch,
    assignedAt: row.assignedAt,
  };
  if (row.state === "queued") {
    return { ...base, state: row.state, runnerId: row.runnerId };
  }
  const { runnerId, worktreeRef: worktree, startedAt } = row;
  if (runnerId === null || worktree === null || startedAt === null) {
    throw new RunRowError(row.id, `${row.state} run without runner, worktree or start time`);
  }
  if (row.state !== "ended") {
    return { ...base, state: row.state, runnerId, worktree, startedAt };
  }
  const { endedAt, agentResult, prState } = row;
  if (endedAt === null || agentResult === null || prState === null) {
    throw new RunRowError(row.id, "ended run without end time or the two axes");
  }
  return {
    ...base,
    state: row.state,
    runnerId,
    worktree,
    startedAt,
    endedAt,
    agentResult,
    prState,
  };
}

function toRunRecords(row: RunRow): RunRecords {
  return {
    retryToken: row.retryToken,
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

// ---------- 읽기 ----------

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

/** 런 목록. 할당 순서(대기열 순서)로 돌려준다. */
export function listRuns(
  db: Database,
  filter: { states?: ReadonlyArray<RunState>; ticket?: TicketRef; workspaceId?: WorkspaceId } = {},
): StoredRun[] {
  if (filter.states?.length === 0) return [];
  const conditions: SQL[] = [];
  if (filter.states !== undefined) conditions.push(inArray(runs.state, [...filter.states]));
  if (filter.ticket !== undefined) {
    conditions.push(eq(runs.trackerConnectionId, filter.ticket.connection));
    conditions.push(eq(runs.ticketKey, filter.ticket.key));
  }
  if (filter.workspaceId !== undefined) conditions.push(eq(runs.workspaceId, filter.workspaceId));
  return db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(asc(runs.assignedAt), asc(runs.id))
    .all()
    .map(toStoredRun);
}

/** capacity를 셀 런(Ended 빼고). core remainingCapacity·pickRunner·planQueue에 넘긴다. */
export function listRunPlacements(db: Database): RunPlacement[] {
  return db
    .select({ runnerId: runs.runnerId, state: runs.state })
    .from(runs)
    .where(ne(runs.state, "ended"))
    .all();
}

// ---------- 할당 진입점 ----------

export interface AssignRunInput {
  ticket: TicketRef;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  /** 운영자가 고른 러너(수동 할당, Q53·Q60). 없으면 core 규칙으로 고른다 */
  runnerId?: RunnerId;
  now?: Date;
}

export type AssignRunResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      reason:
        | "active-run"
        /** 트래커 프로젝트가 어느 Workspace에도 묶이지 않음 */
        | "unknown-tracker-project"
        /** 운영자가 고른 러너가 등록되지 않음 */
        | "unknown-runner";
    };

/**
 * 할당 진입점. web의 수동 할당(0021)과 worker의 자동 할당(0018)이 함께 쓴다.
 *
 * 1. core 할당 조건: 같은 티켓에 Queued·Running·Waiting for Input·Disconnected 런이 있으면
 *    만들지 않는다(Q45·Q74). 같은 트랜잭션 안에서 보고, 유니크 인덱스가 한 번 더 막는다.
 * 2. 운영자가 러너를 고르지 않았으면 core pickRunner로 러너 쪽 프로젝트가 있는 Online 러너 중
 *    남은 capacity가 가장 많은 러너를 고른다(Q53). 없으면 러너 없이 둔다(Q65).
 * 3. Queued 런을 만들고 상태 이력에 할당을 남긴다. 브랜치는 `factory/<티켓 키>-<런 번호>`다(Q40).
 */
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
      const exists = db
        .select({ id: runners.id })
        .from(runners)
        .where(eq(runners.id, input.runnerId))
        .get();
      if (exists === undefined) return { ok: false, reason: "unknown-runner" };
      runnerId = input.runnerId;
    }

    // 런 번호는 트래커 연결과 상관없이 티켓 키로 센다. 두 연결에 같은 키가 있어도 브랜치가 겹치지 않는다.
    const sameKeyRuns =
      db.select({ n: count() }).from(runs).where(eq(runs.ticketKey, input.ticket.key)).get()?.n ??
      0;
    const id = toRunId(randomUUID());
    db.insert(runs)
      .values({
        id,
        trackerConnectionId: input.ticket.connection,
        ticketKey: input.ticket.key,
        workspaceId: project.workspaceId,
        trackerProjectId: input.trackerProject,
        runnerProjectId: input.runnerProject,
        agentId: input.agent,
        branch: `factory/${input.ticket.key}-${sameKeyRuns + 1}`,
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

// ---------- 상태 변경 ----------

export type RunStateChange =
  /** Queued에서 시작할 때는 워크트리를 함께 적는다. 다시 연결·입력 기다림에서 돌아올 때는 없다 */
  | { to: "running"; worktree?: WorktreeRef }
  | { to: "waiting-for-input" | "disconnected" }
  /** 끝남. 두 축을 한 번 기록한다(ADR 0004) */
  | { to: "ended"; agentResult: AgentResult; prState: PrState };

export type ChangeRunStateResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      error:
        | InvalidRunTransition
        | { kind: "not-found" }
        | { kind: "no-runner" }
        | { kind: "no-worktree" };
    };

/**
 * 런 상태를 바꾼다. 허용하는 전이인지는 core transitionRun이 정한다(스펙 4.1).
 * 이력에 바뀐 시각을 남긴다. 읽기와 쓰기가 한 쓰기 트랜잭션 안이라 그 사이 다른 쪽이 바꾸지 못한다.
 */
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
    if (current.state === "queued") {
      // 전이 표에서 Queued의 다음은 Running뿐이다.
      if (current.runnerId === null) return { ok: false, error: { kind: "no-runner" } };
      if (change.to !== "running" || change.worktree === undefined) {
        return { ok: false, error: { kind: "no-worktree" } };
      }
      db.update(runs)
        .set({ state: "running", startedAt: now, worktreeRef: change.worktree })
        .where(where)
        .run();
    } else if (change.to === "ended") {
      db.update(runs)
        .set({
          state: "ended",
          endedAt: now,
          agentResult: change.agentResult,
          prState: change.prState,
        })
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

/**
 * Queued 런의 러너를 정하거나 비운다(core planQueue의 cleared·assigned, Q65·Q72·Q73).
 * assigned_at은 바꾸지 않아 원래 자리로 돌아간다. Queued가 아니면 false다.
 */
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

/** 런의 상태 변경 이력(Run 상세 타임라인, 0022). 오래된 것부터 */
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

// ---------- 그 밖의 기록 ----------

/**
 * 런 상태와 두 축 밖의 기록을 고친다. 준 키만 바꾼다. 두 축은 여기서 바꿀 수 없다(Q69).
 * 이후 PR 상태는 Ended 런에만 적힌다(CHECK 제약).
 */
export function updateRunRecords(db: Database, runId: RunId, patch: Partial<RunRecords>): boolean {
  const set: Partial<typeof runs.$inferInsert> = {};
  if (patch.retryToken !== undefined) set.retryToken = patch.retryToken;
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
