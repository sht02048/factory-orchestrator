import { randomUUID } from "node:crypto";
import {
  AGENT_RESULTS,
  PR_STATES,
  RUN_STATES,
  checkAssignment,
  pickRunner,
  toAgentId,
  toCommentId,
  toPullRequestId,
  toRetryToken,
  toRunId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
  toWorktreeRef,
  transitionRun,
} from "@factory/core";
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
import { z } from "zod";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { toWorkspaceId } from "./ids.js";
import type { WorkspaceId } from "./ids.js";
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
  laterPrState: { state: "merged" | "closed"; at: Date } | null;
  worktreeRemovedAt: Date | null;
  trackerStateSetAt: Date | null;
  trackerComment: { id: CommentId; at: Date } | null;
  unreachableSince: Date | null;
  lastLog: string[] | null;
}

/** 런이 끝날 때 저장하는 로그 줄 수(Q46) */
export const LAST_LOG_LINES = 200;

// ---------- 행 파싱 ----------

const time = z
  .number()
  .int()
  .transform((ms) => new Date(ms));

const runRow = z.object({
  id: z.string().transform(toRunId),
  tracker_connection_id: z.string().transform(toTrackerConnectionId),
  ticket_key: z.string().transform(toTicketKey),
  workspace_id: z.string().transform(toWorkspaceId),
  tracker_project_id: z.string().transform(toTrackerProjectId),
  runner_project_id: z.string().transform(toRunnerProjectId),
  agent_id: z.string().transform(toAgentId),
  branch: z.string(),
  state: z.enum(RUN_STATES),
  runner_id: z.string().transform(toRunnerId).nullable(),
  assigned_at: time,
  started_at: time.nullable(),
  ended_at: time.nullable(),
  worktree_ref: z.string().transform(toWorktreeRef).nullable(),
  agent_result: z.enum(AGENT_RESULTS).nullable(),
  pr_state: z.enum(PR_STATES).nullable(),
  retry_token: z.string().transform(toRetryToken).nullable(),
  pr_id: z.string().transform(toPullRequestId).nullable(),
  pr_display_id: z.string().nullable(),
  pr_url: z.string().nullable(),
  pr_ci_state: z.string().nullable(),
  pr_checked_at: time.nullable(),
  later_pr_state: z.enum(["merged", "closed"]).nullable(),
  later_pr_state_at: time.nullable(),
  worktree_removed_at: time.nullable(),
  tracker_state_set_at: time.nullable(),
  tracker_comment_id: z.string().transform(toCommentId).nullable(),
  tracker_commented_at: time.nullable(),
  unreachable_since: time.nullable(),
  last_log: z
    .string()
    .nullable()
    .transform((text, ctx) => {
      if (text === null) return null;
      const parsed = z.array(z.string()).safeParse(JSON.parse(text));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "last_log is not a string array" });
        return z.NEVER;
      }
      return parsed.data;
    }),
});
type RunRow = z.infer<typeof runRow>;

/** DB의 런 행이 core Run 모양을 지키지 않음. CHECK 제약이 막으므로 생기면 버그다. */
export class RunRowError extends Error {
  constructor(runId: string, message: string) {
    super(`run ${runId}: ${message}`);
    this.name = "RunRowError";
  }
}

function toStoredRun(row: RunRow): StoredRun {
  const base = {
    id: row.id,
    workspaceId: row.workspace_id,
    ticket: { connection: row.tracker_connection_id, key: row.ticket_key },
    trackerProject: row.tracker_project_id,
    runnerProject: row.runner_project_id,
    agent: row.agent_id,
    branch: row.branch,
    assignedAt: row.assigned_at,
  };
  if (row.state === "queued") {
    return { ...base, state: row.state, runnerId: row.runner_id };
  }
  const { runner_id: runnerId, worktree_ref: worktree, started_at: startedAt } = row;
  if (runnerId === null || worktree === null || startedAt === null) {
    throw new RunRowError(row.id, `${row.state} run without runner, worktree or start time`);
  }
  if (row.state !== "ended") {
    return { ...base, state: row.state, runnerId, worktree, startedAt };
  }
  const { ended_at: endedAt, agent_result: agentResult, pr_state: prState } = row;
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
    retryToken: row.retry_token,
    pullRequest:
      row.pr_id === null || row.pr_checked_at === null
        ? null
        : {
            id: row.pr_id,
            displayId: row.pr_display_id ?? "",
            url: row.pr_url ?? "",
            ci: row.pr_ci_state ?? "none",
            checkedAt: row.pr_checked_at,
          },
    laterPrState:
      row.later_pr_state === null || row.later_pr_state_at === null
        ? null
        : { state: row.later_pr_state, at: row.later_pr_state_at },
    worktreeRemovedAt: row.worktree_removed_at,
    trackerStateSetAt: row.tracker_state_set_at,
    trackerComment:
      row.tracker_comment_id === null || row.tracker_commented_at === null
        ? null
        : { id: row.tracker_comment_id, at: row.tracker_commented_at },
    unreachableSince: row.unreachable_since,
    lastLog: row.last_log,
  };
}

// ---------- 읽기 ----------

export function getRun(db: Database, id: RunId): StoredRun | null {
  const raw = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  return raw === undefined ? null : toStoredRun(runRow.parse(raw));
}

export function getRunWithRecords(
  db: Database,
  id: RunId,
): { run: StoredRun; records: RunRecords } | null {
  const raw = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  if (raw === undefined) return null;
  const row = runRow.parse(raw);
  return { run: toStoredRun(row), records: toRunRecords(row) };
}

/** 런 목록. 할당 순서(대기열 순서)로 돌려준다. */
export function listRuns(
  db: Database,
  filter: { states?: ReadonlyArray<RunState>; ticket?: TicketRef; workspaceId?: WorkspaceId } = {},
): StoredRun[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.states !== undefined) {
    if (filter.states.length === 0) return [];
    where.push(`state IN (${filter.states.map(() => "?").join(", ")})`);
    params.push(...filter.states);
  }
  if (filter.ticket !== undefined) {
    where.push("tracker_connection_id = ? AND ticket_key = ?");
    params.push(filter.ticket.connection, filter.ticket.key);
  }
  if (filter.workspaceId !== undefined) {
    where.push("workspace_id = ?");
    params.push(filter.workspaceId);
  }
  const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  return db
    .prepare(`SELECT * FROM runs ${clause} ORDER BY assigned_at, rowid`)
    .all(...params)
    .map((raw) => toStoredRun(runRow.parse(raw)));
}

const placementRow = z.object({
  runner_id: z.string().transform(toRunnerId).nullable(),
  state: z.enum(RUN_STATES),
});

/** capacity를 셀 런(Ended 빼고). core remainingCapacity·pickRunner·planQueue에 넘긴다. */
export function listRunPlacements(db: Database): RunPlacement[] {
  return db
    .prepare("SELECT runner_id, state FROM runs WHERE state <> 'ended'")
    .all()
    .map((raw) => {
      const row = placementRow.parse(raw);
      return { runnerId: row.runner_id, state: row.state };
    });
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

    const ticketRuns = listRuns(db, { ticket: input.ticket });
    const check = checkAssignment({ ticket: input.ticket, runs: ticketRuns });
    if (!check.ok) return { ok: false, reason: "active-run" };

    let runnerId: RunnerId | null;
    if (input.runnerId === undefined) {
      runnerId = pickRunner({
        project: input.runnerProject,
        runners: listRunnerSnapshots(db),
        runs: listRunPlacements(db),
      });
    } else {
      const exists = db.prepare("SELECT 1 FROM runners WHERE id = ?").get(input.runnerId);
      if (exists === undefined) return { ok: false, reason: "unknown-runner" };
      runnerId = input.runnerId;
    }

    const id = toRunId(randomUUID());
    // 런 번호는 트래커 연결과 상관없이 티켓 키로 센다. 두 연결에 같은 키가 있어도 브랜치가 겹치지 않는다.
    const sameKeyRuns = db
      .prepare("SELECT count(*) AS n FROM runs WHERE ticket_key = ?")
      .get(input.ticket.key)?.["n"];
    const branch = `factory/${input.ticket.key}-${Number(sameKeyRuns ?? 0) + 1}`;
    db.prepare(
      `INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
         runner_project_id, agent_id, branch, state, runner_id, assigned_at)
       VALUES (:id, :connection, :key, :workspace, :trackerProject,
         :runnerProject, :agent, :branch, 'queued', :runner, :now)`,
    ).run({
      id,
      connection: input.ticket.connection,
      key: input.ticket.key,
      workspace: project.workspaceId,
      trackerProject: input.trackerProject,
      runnerProject: input.runnerProject,
      agent: input.agent,
      branch,
      runner: runnerId,
      now: now.getTime(),
    });
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
 * 이력에 바뀐 시각을 남긴다. 읽은 상태가 그 사이 바뀌었으면 쓰지 않는다.
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

    const at = now.getTime();
    if (current.state === "queued") {
      // 전이 표에서 Queued의 다음은 Running뿐이다.
      if (current.runnerId === null) return { ok: false, error: { kind: "no-runner" } };
      if (change.to !== "running" || change.worktree === undefined) {
        return { ok: false, error: { kind: "no-worktree" } };
      }
      db.prepare(
        "UPDATE runs SET state = 'running', started_at = ?, worktree_ref = ? WHERE id = ? AND state = 'queued'",
      ).run(at, change.worktree, runId);
    } else if (change.to === "ended") {
      db.prepare(
        `UPDATE runs SET state = 'ended', ended_at = ?, agent_result = ?, pr_state = ?
         WHERE id = ? AND state = ?`,
      ).run(at, change.agentResult, change.prState, runId, current.state);
    } else {
      db.prepare("UPDATE runs SET state = ? WHERE id = ? AND state = ?").run(
        change.to,
        runId,
        current.state,
      );
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
    .prepare("UPDATE runs SET runner_id = ? WHERE id = ? AND state = 'queued'")
    .run(runnerId, runId);
  return result.changes > 0;
}

function recordStateChange(
  db: Database,
  runId: RunId,
  from: RunState | null,
  to: RunState,
  now: Date,
): void {
  db.prepare(
    "INSERT INTO run_state_changes (run_id, from_state, to_state, changed_at) VALUES (?, ?, ?, ?)",
  ).run(runId, from, to, now.getTime());
}

export interface RunStateChangeRecord {
  from: RunState | null;
  to: RunState;
  at: Date;
}

const stateChangeRow = z.object({
  from_state: z.enum(RUN_STATES).nullable(),
  to_state: z.enum(RUN_STATES),
  changed_at: time,
});

/** 런의 상태 변경 이력(Run 상세 타임라인, 0022). 오래된 것부터 */
export function listRunStateChanges(db: Database, runId: RunId): RunStateChangeRecord[] {
  return db
    .prepare(
      "SELECT from_state, to_state, changed_at FROM run_state_changes WHERE run_id = ? ORDER BY id",
    )
    .all(runId)
    .map((raw) => {
      const row = stateChangeRow.parse(raw);
      return { from: row.from_state, to: row.to_state, at: row.changed_at };
    });
}

// ---------- 그 밖의 기록 ----------

/**
 * 런 상태와 두 축 밖의 기록을 고친다. 준 키만 바꾼다. 두 축은 여기서 바꿀 수 없다(Q69).
 * 이후 PR 상태는 Ended 런에만 적힌다(CHECK 제약).
 */
export function updateRunRecords(db: Database, runId: RunId, patch: Partial<RunRecords>): boolean {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  const ms = (date: Date | null): number | null => (date === null ? null : date.getTime());

  if (patch.retryToken !== undefined) set("retry_token", patch.retryToken);
  if (patch.pullRequest !== undefined) {
    const pr = patch.pullRequest;
    set("pr_id", pr?.id ?? null);
    set("pr_display_id", pr?.displayId ?? null);
    set("pr_url", pr?.url ?? null);
    set("pr_ci_state", pr?.ci ?? null);
    set("pr_checked_at", ms(pr?.checkedAt ?? null));
  }
  if (patch.laterPrState !== undefined) {
    set("later_pr_state", patch.laterPrState?.state ?? null);
    set("later_pr_state_at", ms(patch.laterPrState?.at ?? null));
  }
  if (patch.worktreeRemovedAt !== undefined)
    set("worktree_removed_at", ms(patch.worktreeRemovedAt));
  if (patch.trackerStateSetAt !== undefined)
    set("tracker_state_set_at", ms(patch.trackerStateSetAt));
  if (patch.trackerComment !== undefined) {
    set("tracker_comment_id", patch.trackerComment?.id ?? null);
    set("tracker_commented_at", ms(patch.trackerComment?.at ?? null));
  }
  if (patch.unreachableSince !== undefined) set("unreachable_since", ms(patch.unreachableSince));
  if (patch.lastLog !== undefined) {
    set(
      "last_log",
      patch.lastLog === null ? null : JSON.stringify(patch.lastLog.slice(-LAST_LOG_LINES)),
    );
  }
  if (sets.length === 0) return false;

  const result = db
    .prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params, runId);
  return result.changes > 0;
}
