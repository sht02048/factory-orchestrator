import type {
  AgentId,
  CodeHostKind,
  LabelId,
  MailboxRef,
  RunnerErrorDetail,
  RunnerId,
  RunnerKind,
  RunnerPrerequisite,
  RunnerProject,
  RunnerProjectId,
  RunnerSnapshot,
  TrackerConnectionId,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
} from "@factory/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import type { CodeHostConnectionId, WorkspaceId } from "./ids.js";
import {
  autoAssignLabels,
  codeHostConnections,
  mappings,
  runnerProjects,
  runners,
  trackerConnections,
  workspaceTrackerProjects,
  workspaces,
} from "./schema.js";
import type { SecretBox } from "./secret-box.js";

/**
 * 설정 테이블 접근. 서비스마다 다른 값은 어댑터가 정하는 JSON(`config`)과 봉한 비밀값(`secrets`)에
 * 넣는다. db는 그 안을 해석하지 않고, 어댑터 factory가 경계에서 스키마로 파싱한다(core registry).
 */

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function toJson(value: unknown, what: string): string {
  const text = JSON.stringify(value);
  // JSON.stringify(undefined)는 문자열이 아니다. 쓰기 전에 막는다.
  if (typeof text !== "string") throw new TypeError(`${what} must be JSON`);
  return text;
}

// ---------- 연결(트래커, 코드 호스트) ----------

export interface StoredConnection<Id, Kind> {
  id: Id;
  kind: Kind;
  name: string;
  /** 비밀이 아닌 어댑터 설정 */
  config: unknown;
  /** 복호화한 비밀값(API 키, signing secret, 토큰). 어댑터 설정과 함께 factory에 넘긴다 */
  secrets: unknown;
}

export interface ConnectionInput<Id, Kind> {
  id: Id;
  kind: Kind;
  name: string;
  config: unknown;
  secrets: unknown;
}

/** 봉한 값이 묶이는 자리. 한 행의 값을 다른 행에 옮겨 붙이면 열리지 않는다. */
const sealContext = (
  table: "tracker_connections" | "code_host_connections",
  id: TrackerConnectionId | CodeHostConnectionId,
) => `${table}:${id}`;

export type StoredTrackerConnection = StoredConnection<TrackerConnectionId, TrackerKind>;

export function saveTrackerConnection(
  db: Database,
  box: SecretBox,
  input: ConnectionInput<TrackerConnectionId, TrackerKind>,
  now: Date = new Date(),
): void {
  const values = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    config: toJson(input.config, "connection config"),
    secrets: box.seal(
      toJson(input.secrets, "connection secrets"),
      sealContext("tracker_connections", input.id),
    ),
  };
  db.insert(trackerConnections)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: trackerConnections.id, set: values })
    .run();
}

export function listTrackerConnections(db: Database, box: SecretBox): StoredTrackerConnection[] {
  return db
    .select()
    .from(trackerConnections)
    .orderBy(asc(trackerConnections.createdAt), asc(trackerConnections.id))
    .all()
    .map((row) => openTrackerConnection(box, row));
}

export function getTrackerConnection(
  db: Database,
  box: SecretBox,
  id: TrackerConnectionId,
): StoredTrackerConnection | null {
  const row = db.select().from(trackerConnections).where(eq(trackerConnections.id, id)).get();
  return row === undefined ? null : openTrackerConnection(box, row);
}

function openTrackerConnection(
  box: SecretBox,
  row: typeof trackerConnections.$inferSelect,
): StoredTrackerConnection {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: parseJson(row.config),
    secrets: parseJson(box.open(row.secrets, sealContext("tracker_connections", row.id))),
  };
}

export type StoredCodeHostConnection = StoredConnection<CodeHostConnectionId, CodeHostKind>;

export function saveCodeHostConnection(
  db: Database,
  box: SecretBox,
  input: ConnectionInput<CodeHostConnectionId, CodeHostKind>,
  now: Date = new Date(),
): void {
  const values = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    config: toJson(input.config, "connection config"),
    secrets: box.seal(
      toJson(input.secrets, "connection secrets"),
      sealContext("code_host_connections", input.id),
    ),
  };
  db.insert(codeHostConnections)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: codeHostConnections.id, set: values })
    .run();
}

export function listCodeHostConnections(db: Database, box: SecretBox): StoredCodeHostConnection[] {
  return db
    .select()
    .from(codeHostConnections)
    .orderBy(asc(codeHostConnections.createdAt), asc(codeHostConnections.id))
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      config: parseJson(row.config),
      secrets: parseJson(box.open(row.secrets, sealContext("code_host_connections", row.id))),
    }));
}

// ---------- 러너 ----------

export interface StoredRunner {
  id: RunnerId;
  kind: RunnerKind;
  name: string;
  /** 어댑터 설정(ssh 대상, 실행 파일 경로 등) */
  config: unknown;
  capacity: number;
  online: boolean;
  /** 할당을 막는 필수 조건이 깨졌는지(1단계는 GitHub 인증, Q82.14) */
  assignmentBlocked: boolean;
  /**
   * 마지막으로 읽은 러너 필수 조건(1단계는 Orca 상시 서비스와 프로젝트별 GitHub 인증, Q82.15).
   * 아직 읽지 못했거나 저장한 값을 읽을 수 없으면 null
   */
  prerequisites: RunnerPrerequisite[] | null;
  /** 러너 어댑터가 만든 우편함. 아직 없으면 null(Q82.1) */
  mailbox: MailboxRef | null;
  checkedAt: Date | null;
  checkError: unknown;
  projects: RunnerProject[];
}

export function saveRunner(
  db: Database,
  input: { id: RunnerId; kind: RunnerKind; name: string; config: unknown; capacity: number },
  now: Date = new Date(),
): void {
  const values = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    config: toJson(input.config, "runner config"),
    capacity: input.capacity,
  };
  db.insert(runners)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: runners.id, set: values })
    .run();
}

/** 저장한 필수 조건(core RunnerPrerequisite) 하나. 읽을 때 모양을 확인한다 */
const storedPrerequisites = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    satisfied: z.boolean().nullable(),
    hint: z.string().nullable(),
    blocksAssignment: z.boolean(),
  }),
);

function readPrerequisites(text: string | null): RunnerPrerequisite[] | null {
  if (text === null) return null;
  const parsed = storedPrerequisites.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

/**
 * 러너 상태 확인 결과를 쓴다(0016). Online 여부, 확인 시각, 오류, 러너 쪽 프로젝트 목록,
 * 할당을 막는 필수 조건이 깨졌는지(core isAssignmentBlocked, Q82.14)와 필수 조건 하나하나의 결과
 * (프로젝트별 GitHub 인증, Q82.15)를 바꾼다. 러너에 닿지 못해 프로젝트 목록이나 필수 조건을 읽지
 * 못했으면 null로 줘 이전 값을 남긴다. `prerequisites`를 주지 않아도 이전 값을 남긴다.
 * `assignmentBlocked`는 `prerequisites`로 계산한 값(core isAssignmentBlocked)을 준다.
 */
export function recordRunnerCheck(
  db: Database,
  input: {
    runnerId: RunnerId;
    online: boolean;
    checkedAt: Date;
    error: RunnerErrorDetail | null;
    projects: ReadonlyArray<RunnerProject> | null;
    assignmentBlocked: boolean | null;
    prerequisites?: ReadonlyArray<RunnerPrerequisite> | null;
  },
): void {
  inTransaction(db, () => {
    db.update(runners)
      .set({
        online: input.online,
        checkedAt: input.checkedAt,
        checkError: input.error === null ? null : toJson(input.error, "runner check error"),
        ...(input.assignmentBlocked === null ? {} : { assignmentBlocked: input.assignmentBlocked }),
        ...(input.prerequisites === undefined || input.prerequisites === null
          ? {}
          : { prerequisites: toJson(input.prerequisites, "runner prerequisites") }),
      })
      .where(eq(runners.id, input.runnerId))
      .run();
    if (input.projects === null) return;
    db.delete(runnerProjects).where(eq(runnerProjects.runnerId, input.runnerId)).run();
    if (input.projects.length === 0) return;
    db.insert(runnerProjects)
      .values(
        input.projects.map((project) => ({
          runnerId: input.runnerId,
          projectId: project.id,
          displayName: project.displayName,
          setupState: project.setupState,
        })),
      )
      .run();
  });
}

export function listRunners(db: Database): StoredRunner[] {
  const projects = db
    .select()
    .from(runnerProjects)
    .orderBy(asc(runnerProjects.runnerId), asc(runnerProjects.projectId))
    .all();
  return db
    .select()
    .from(runners)
    .orderBy(asc(runners.createdAt), asc(runners.id))
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      config: parseJson(row.config),
      capacity: row.capacity,
      online: row.online,
      assignmentBlocked: row.assignmentBlocked,
      prerequisites: readPrerequisites(row.prerequisites),
      mailbox: row.mailboxRef,
      checkedAt: row.checkedAt,
      checkError: row.checkError === null ? null : parseJson(row.checkError),
      projects: projects
        .filter((p) => p.runnerId === row.id)
        .map((p) => ({ id: p.projectId, displayName: p.displayName, setupState: p.setupState })),
    }));
}

/**
 * 러너 어댑터가 만들거나 확인한 우편함을 쓴다(core Runner.ensureMailbox, Q82.1). 바뀌었을 때만 쓰면 된다.
 */
export function setRunnerMailbox(
  db: Database,
  runnerId: RunnerId,
  mailbox: MailboxRef | null,
): void {
  db.update(runners).set({ mailboxRef: mailbox }).where(eq(runners.id, runnerId)).run();
}

/** core 할당·대기열 판단에 넘기는 러너 모습 */
export function listRunnerSnapshots(db: Database): RunnerSnapshot[] {
  return listRunners(db).map((runner) => ({
    id: runner.id,
    online: runner.online,
    assignmentBlocked: runner.assignmentBlocked,
    capacity: runner.capacity,
    projects: runner.projects.map((p) => p.id),
  }));
}

// ---------- Workspace, 트래커 프로젝트, Mapping, Auto-assign Label ----------

export const DEFAULT_MAX_RUN_MS = 2 * 60 * 60 * 1000;

export interface StoredWorkspace {
  id: WorkspaceId;
  name: string;
  maxRunMs: number;
}

export function saveWorkspace(
  db: Database,
  input: { id: WorkspaceId; name: string; maxRunMs?: number },
  now: Date = new Date(),
): void {
  const values = { name: input.name, maxRunMs: input.maxRunMs ?? DEFAULT_MAX_RUN_MS };
  db.insert(workspaces)
    .values({ id: input.id, ...values, createdAt: now })
    .onConflictDoUpdate({ target: workspaces.id, set: values })
    .run();
}

export function listWorkspaces(db: Database): StoredWorkspace[] {
  return db
    .select({ id: workspaces.id, name: workspaces.name, maxRunMs: workspaces.maxRunMs })
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
    .all();
}

export interface StoredWorkspaceTrackerProject {
  workspaceId: WorkspaceId;
  connection: TrackerConnectionId;
  projectId: TrackerProjectId;
  name: string;
  inProgressStateId: TrackerStateId | null;
}

/**
 * 트래커 프로젝트를 Workspace에 묶는다. 이미 다른 Workspace에 묶인 트래커 프로젝트면 false를
 * 돌려주고 바꾸지 않는다(ADR 0006). 같은 Workspace면 이름과 "In Progress" 상태를 고친다.
 */
export function saveWorkspaceTrackerProject(
  db: Database,
  input: StoredWorkspaceTrackerProject,
): boolean {
  const result = db
    .insert(workspaceTrackerProjects)
    .values({
      trackerConnectionId: input.connection,
      trackerProjectId: input.projectId,
      workspaceId: input.workspaceId,
      name: input.name,
      inProgressStateId: input.inProgressStateId,
    })
    .onConflictDoUpdate({
      target: [
        workspaceTrackerProjects.trackerConnectionId,
        workspaceTrackerProjects.trackerProjectId,
      ],
      set: { name: input.name, inProgressStateId: input.inProgressStateId },
      setWhere: sql`${workspaceTrackerProjects.workspaceId} = excluded.workspace_id`,
    })
    .run();
  return result.changes > 0;
}

export function getWorkspaceTrackerProject(
  db: Database,
  connection: TrackerConnectionId,
  projectId: TrackerProjectId,
): StoredWorkspaceTrackerProject | null {
  const row = db
    .select({
      workspaceId: workspaceTrackerProjects.workspaceId,
      connection: workspaceTrackerProjects.trackerConnectionId,
      projectId: workspaceTrackerProjects.trackerProjectId,
      name: workspaceTrackerProjects.name,
      inProgressStateId: workspaceTrackerProjects.inProgressStateId,
    })
    .from(workspaceTrackerProjects)
    .where(
      and(
        eq(workspaceTrackerProjects.trackerConnectionId, connection),
        eq(workspaceTrackerProjects.trackerProjectId, projectId),
      ),
    )
    .get();
  return row ?? null;
}

/**
 * Workspace에 묶인 트래커 프로젝트. `workspaceId`를 주면 그 Workspace 것만, 없으면 모든 Workspace 것을
 * 돌려준다. 묶은 순서가 아니라 트래커 연결, 이름 순서다.
 */
export function listWorkspaceTrackerProjects(
  db: Database,
  workspaceId?: WorkspaceId,
): StoredWorkspaceTrackerProject[] {
  return db
    .select({
      workspaceId: workspaceTrackerProjects.workspaceId,
      connection: workspaceTrackerProjects.trackerConnectionId,
      projectId: workspaceTrackerProjects.trackerProjectId,
      name: workspaceTrackerProjects.name,
      inProgressStateId: workspaceTrackerProjects.inProgressStateId,
    })
    .from(workspaceTrackerProjects)
    .where(
      workspaceId === undefined ? undefined : eq(workspaceTrackerProjects.workspaceId, workspaceId),
    )
    .orderBy(
      asc(workspaceTrackerProjects.trackerConnectionId),
      asc(workspaceTrackerProjects.name),
      asc(workspaceTrackerProjects.trackerProjectId),
    )
    .all();
}

/**
 * 트래커 프로젝트를 Workspace에서 뺀다. 그 Workspace에 묶여 있을 때만 빼고 true를 돌려준다.
 * 그 트래커 프로젝트의 Mapping은 외래 키로 함께 지워진다. 런은 트래커 프로젝트를 외래 키로 묶지 않아
 * 지난 런과 통계는 남는다(schema `runs.trackerProjectId`). 그 Mapping을 쓰던 Queued 런은 대기열 맨 앞에
 * 오면 시작할 수 없음으로 끝난다(Q82.16).
 */
export function removeWorkspaceTrackerProject(
  db: Database,
  input: { workspaceId: WorkspaceId; connection: TrackerConnectionId; projectId: TrackerProjectId },
): boolean {
  return (
    db
      .delete(workspaceTrackerProjects)
      .where(
        and(
          eq(workspaceTrackerProjects.workspaceId, input.workspaceId),
          eq(workspaceTrackerProjects.trackerConnectionId, input.connection),
          eq(workspaceTrackerProjects.trackerProjectId, input.projectId),
        ),
      )
      .run().changes > 0
  );
}

export interface StoredMapping {
  connection: TrackerConnectionId;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  /** 에이전트 모델(0043). null 이면 정하지 않았다(러너 설정, 그다음 러너 도구의 기본값) */
  model: string | null;
}

/** Mapping 을 저장한다. model 을 주지 않으면 정하지 않은 것(null)으로 저장한다 */
export function saveMapping(
  db: Database,
  input: Omit<StoredMapping, "model"> & { model?: string | null },
): void {
  const model = input.model ?? null;
  db.insert(mappings)
    .values({
      trackerConnectionId: input.connection,
      trackerProjectId: input.trackerProject,
      runnerProjectId: input.runnerProject,
      agentId: input.agent,
      model,
    })
    .onConflictDoUpdate({
      target: [mappings.trackerConnectionId, mappings.trackerProjectId],
      set: { runnerProjectId: input.runnerProject, agentId: input.agent, model },
    })
    .run();
}

export function getMapping(
  db: Database,
  connection: TrackerConnectionId,
  trackerProject: TrackerProjectId,
): StoredMapping | null {
  const row = db
    .select({
      connection: mappings.trackerConnectionId,
      trackerProject: mappings.trackerProjectId,
      runnerProject: mappings.runnerProjectId,
      agent: mappings.agentId,
      model: mappings.model,
    })
    .from(mappings)
    .where(
      and(
        eq(mappings.trackerConnectionId, connection),
        eq(mappings.trackerProjectId, trackerProject),
      ),
    )
    .get();
  return row ?? null;
}

export function saveAutoAssignLabel(
  db: Database,
  input: { workspaceId: WorkspaceId; connection: TrackerConnectionId; labelId: LabelId },
): void {
  db.insert(autoAssignLabels)
    .values({
      workspaceId: input.workspaceId,
      trackerConnectionId: input.connection,
      labelId: input.labelId,
    })
    .onConflictDoUpdate({
      target: [autoAssignLabels.workspaceId, autoAssignLabels.trackerConnectionId],
      set: { labelId: input.labelId },
    })
    .run();
}

export function getAutoAssignLabel(
  db: Database,
  workspaceId: WorkspaceId,
  connection: TrackerConnectionId,
): LabelId | null {
  const row = db
    .select({ labelId: autoAssignLabels.labelId })
    .from(autoAssignLabels)
    .where(
      and(
        eq(autoAssignLabels.workspaceId, workspaceId),
        eq(autoAssignLabels.trackerConnectionId, connection),
      ),
    )
    .get();
  return row?.labelId ?? null;
}
