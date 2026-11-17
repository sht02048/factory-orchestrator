import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type {
  AgentId,
  CodeHostKind,
  LabelId,
  RunnerErrorDetail,
  RunnerId,
  RunnerKind,
  RunnerProject,
  RunnerProjectId,
  RunnerSnapshot,
  TrackerConnectionId,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
} from "@factory/core";
import { z } from "zod";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { toCodeHostConnectionId, toWorkspaceId } from "./ids.js";
import type { CodeHostConnectionId, WorkspaceId } from "./ids.js";
import type { SecretBox } from "./secret-box.js";

/**
 * 설정 테이블 접근. 서비스마다 다른 값은 어댑터가 정하는 JSON(`config`)과 봉한 비밀값(`secrets`)에
 * 넣는다. db는 그 안을 해석하지 않고, 어댑터 factory가 경계에서 스키마로 파싱한다(core registry).
 */

const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    ctx.addIssue({ code: "custom", message: "not JSON" });
    return z.NEVER;
  }
});

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

type ConnectionTable = "tracker_connections" | "code_host_connections";

const connectionRow = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  config: jsonText,
  secrets: z.string(),
});

function sealContext(table: ConnectionTable, id: string): string {
  return `${table}:${id}`;
}

function saveConnection(
  db: Database,
  box: SecretBox,
  table: ConnectionTable,
  input: { id: string; kind: string; name: string; config: unknown; secrets: unknown },
  now: Date,
): void {
  const sealed = box.seal(JSON.stringify(input.secrets), sealContext(table, input.id));
  db.prepare(
    `INSERT INTO ${table} (id, kind, name, config, secrets, created_at)
     VALUES (:id, :kind, :name, :config, :secrets, :now)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind, name = excluded.name,
       config = excluded.config, secrets = excluded.secrets`,
  ).run({
    id: input.id,
    kind: input.kind,
    name: input.name,
    config: JSON.stringify(input.config),
    secrets: sealed,
    now: now.getTime(),
  });
}

function readConnections(
  db: Database,
  box: SecretBox,
  table: ConnectionTable,
  id: string | null,
): Array<Omit<z.infer<typeof connectionRow>, "secrets"> & { secrets: unknown }> {
  const rows =
    id === null
      ? db.prepare(`SELECT * FROM ${table} ORDER BY created_at, id`).all()
      : db.prepare(`SELECT * FROM ${table} WHERE id = ?`).all(id);
  return rows.map((raw) => {
    const row = connectionRow.parse(raw);
    const secrets: unknown = JSON.parse(box.open(row.secrets, sealContext(table, row.id)));
    return { ...row, secrets };
  });
}

export type StoredTrackerConnection = StoredConnection<TrackerConnectionId, TrackerKind>;

export function saveTrackerConnection(
  db: Database,
  box: SecretBox,
  input: ConnectionInput<TrackerConnectionId, TrackerKind>,
  now: Date = new Date(),
): void {
  saveConnection(db, box, "tracker_connections", input, now);
}

export function listTrackerConnections(db: Database, box: SecretBox): StoredTrackerConnection[] {
  return readConnections(db, box, "tracker_connections", null).map(toTrackerConnection);
}

export function getTrackerConnection(
  db: Database,
  box: SecretBox,
  id: TrackerConnectionId,
): StoredTrackerConnection | null {
  const [row] = readConnections(db, box, "tracker_connections", id).map(toTrackerConnection);
  return row ?? null;
}

function toTrackerConnection(row: {
  id: string;
  kind: string;
  name: string;
  config: unknown;
  secrets: unknown;
}): StoredTrackerConnection {
  return { ...row, id: toTrackerConnectionId(row.id), kind: toTrackerKind(row.kind) };
}

export type StoredCodeHostConnection = StoredConnection<CodeHostConnectionId, CodeHostKind>;

export function saveCodeHostConnection(
  db: Database,
  box: SecretBox,
  input: ConnectionInput<CodeHostConnectionId, CodeHostKind>,
  now: Date = new Date(),
): void {
  saveConnection(db, box, "code_host_connections", input, now);
}

export function listCodeHostConnections(db: Database, box: SecretBox): StoredCodeHostConnection[] {
  return readConnections(db, box, "code_host_connections", null).map((row) => ({
    ...row,
    id: toCodeHostConnectionId(row.id),
    kind: toCodeHostKind(row.kind),
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
  checkedAt: Date | null;
  checkError: unknown;
  projects: RunnerProject[];
}

const runnerRow = z.object({
  id: z.string().transform(toRunnerId),
  kind: z.string().transform(toRunnerKind),
  name: z.string(),
  config: jsonText,
  capacity: z.number().int(),
  online: z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1),
  checked_at: z.number().nullable(),
  check_error: jsonText.nullable(),
});

const runnerProjectRow = z.object({
  runner_id: z.string().transform(toRunnerId),
  project_id: z.string().transform(toRunnerProjectId),
  display_name: z.string(),
  setup_state: z.string(),
});

export function saveRunner(
  db: Database,
  input: { id: RunnerId; kind: RunnerKind; name: string; config: unknown; capacity: number },
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO runners (id, kind, name, config, capacity, created_at)
     VALUES (:id, :kind, :name, :config, :capacity, :now)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind, name = excluded.name,
       config = excluded.config, capacity = excluded.capacity`,
  ).run({
    id: input.id,
    kind: input.kind,
    name: input.name,
    config: JSON.stringify(input.config),
    capacity: input.capacity,
    now: now.getTime(),
  });
}

/**
 * 러너 상태 확인 결과를 쓴다(0016). Online 여부, 확인 시각, 오류, 러너 쪽 프로젝트 목록을 바꾼다.
 * 러너에 닿지 못해 프로젝트 목록을 읽지 못했으면 `projects`를 null로 줘 이전 목록을 남긴다.
 */
export function recordRunnerCheck(
  db: Database,
  input: {
    runnerId: RunnerId;
    online: boolean;
    checkedAt: Date;
    error: RunnerErrorDetail | null;
    projects: ReadonlyArray<RunnerProject> | null;
  },
): void {
  inTransaction(db, () => {
    db.prepare("UPDATE runners SET online = ?, checked_at = ?, check_error = ? WHERE id = ?").run(
      input.online ? 1 : 0,
      input.checkedAt.getTime(),
      input.error === null ? null : JSON.stringify(input.error),
      input.runnerId,
    );
    if (input.projects === null) return;
    db.prepare("DELETE FROM runner_projects WHERE runner_id = ?").run(input.runnerId);
    const insert = db.prepare(
      "INSERT INTO runner_projects (runner_id, project_id, display_name, setup_state) VALUES (?, ?, ?, ?)",
    );
    for (const project of input.projects) {
      insert.run(input.runnerId, project.id, project.displayName, project.setupState);
    }
  });
}

export function listRunners(db: Database): StoredRunner[] {
  const projects = db
    .prepare("SELECT * FROM runner_projects ORDER BY runner_id, project_id")
    .all()
    .map((raw) => runnerProjectRow.parse(raw));
  return db
    .prepare("SELECT * FROM runners ORDER BY created_at, id")
    .all()
    .map((raw) => {
      const row = runnerRow.parse(raw);
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        config: row.config,
        capacity: row.capacity,
        online: row.online,
        checkedAt: row.checked_at === null ? null : new Date(row.checked_at),
        checkError: row.check_error,
        projects: projects
          .filter((p) => p.runner_id === row.id)
          .map((p) => ({
            id: p.project_id,
            displayName: p.display_name,
            setupState: p.setup_state,
          })),
      };
    });
}

/** core 할당·대기열 판단에 넘기는 러너 모습 */
export function listRunnerSnapshots(db: Database): RunnerSnapshot[] {
  return listRunners(db).map((runner) => ({
    id: runner.id,
    online: runner.online,
    capacity: runner.capacity,
    projects: runner.projects.map((p) => p.id),
  }));
}

// ---------- Workspace, 트래커 프로젝트, Mapping, Auto-assign Label ----------

export const DEFAULT_MAX_RUN_MS = 2 * 60 * 60 * 1000;

export function saveWorkspace(
  db: Database,
  input: { id: WorkspaceId; name: string; maxRunMs?: number },
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO workspaces (id, name, max_run_ms, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, max_run_ms = excluded.max_run_ms`,
  ).run(input.id, input.name, input.maxRunMs ?? DEFAULT_MAX_RUN_MS, now.getTime());
}

export interface StoredWorkspace {
  id: WorkspaceId;
  name: string;
  maxRunMs: number;
}

const workspaceRow = z.object({
  id: z.string().transform(toWorkspaceId),
  name: z.string(),
  max_run_ms: z.number().int(),
});

export function listWorkspaces(db: Database): StoredWorkspace[] {
  return db
    .prepare("SELECT id, name, max_run_ms FROM workspaces ORDER BY created_at, id")
    .all()
    .map((raw) => {
      const row = workspaceRow.parse(raw);
      return { id: row.id, name: row.name, maxRunMs: row.max_run_ms };
    });
}

/**
 * 트래커 프로젝트를 Workspace에 묶는다. 이미 다른 Workspace에 묶인 트래커 프로젝트면 false를
 * 돌려주고 바꾸지 않는다(ADR 0006). 같은 Workspace면 이름과 "In Progress" 상태를 고친다.
 */
export function saveWorkspaceTrackerProject(
  db: Database,
  input: {
    workspaceId: WorkspaceId;
    connection: TrackerConnectionId;
    projectId: TrackerProjectId;
    name: string;
    inProgressStateId: TrackerStateId | null;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT INTO workspace_tracker_projects
         (tracker_connection_id, tracker_project_id, workspace_id, name, in_progress_state_id)
       VALUES (:connection, :project, :workspace, :name, :state)
       ON CONFLICT (tracker_connection_id, tracker_project_id) DO UPDATE SET
         name = excluded.name, in_progress_state_id = excluded.in_progress_state_id
       WHERE workspace_tracker_projects.workspace_id = excluded.workspace_id`,
    )
    .run({
      connection: input.connection,
      project: input.projectId,
      workspace: input.workspaceId,
      name: input.name,
      state: input.inProgressStateId,
    });
  return result.changes > 0;
}

export interface StoredWorkspaceTrackerProject {
  workspaceId: WorkspaceId;
  connection: TrackerConnectionId;
  projectId: TrackerProjectId;
  name: string;
  inProgressStateId: TrackerStateId | null;
}

const workspaceTrackerProjectRow = z.object({
  workspace_id: z.string().transform(toWorkspaceId),
  tracker_connection_id: z.string().transform(toTrackerConnectionId),
  tracker_project_id: z.string().transform(toTrackerProjectId),
  name: z.string(),
  in_progress_state_id: z.string().transform(toTrackerStateId).nullable(),
});

export function getWorkspaceTrackerProject(
  db: Database,
  connection: TrackerConnectionId,
  projectId: TrackerProjectId,
): StoredWorkspaceTrackerProject | null {
  const raw = db
    .prepare(
      "SELECT * FROM workspace_tracker_projects WHERE tracker_connection_id = ? AND tracker_project_id = ?",
    )
    .get(connection, projectId);
  if (raw === undefined) return null;
  const row = workspaceTrackerProjectRow.parse(raw);
  return {
    workspaceId: row.workspace_id,
    connection: row.tracker_connection_id,
    projectId: row.tracker_project_id,
    name: row.name,
    inProgressStateId: row.in_progress_state_id,
  };
}

export interface StoredMapping {
  connection: TrackerConnectionId;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
}

export function saveMapping(db: Database, mapping: StoredMapping): void {
  db.prepare(
    `INSERT INTO mappings (tracker_connection_id, tracker_project_id, runner_project_id, agent_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tracker_connection_id, tracker_project_id) DO UPDATE SET
       runner_project_id = excluded.runner_project_id, agent_id = excluded.agent_id`,
  ).run(mapping.connection, mapping.trackerProject, mapping.runnerProject, mapping.agent);
}

const mappingRow = z.object({
  tracker_connection_id: z.string().transform(toTrackerConnectionId),
  tracker_project_id: z.string().transform(toTrackerProjectId),
  runner_project_id: z.string().transform(toRunnerProjectId),
  agent_id: z.string().transform(toAgentId),
});

export function getMapping(
  db: Database,
  connection: TrackerConnectionId,
  trackerProject: TrackerProjectId,
): StoredMapping | null {
  const raw = db
    .prepare("SELECT * FROM mappings WHERE tracker_connection_id = ? AND tracker_project_id = ?")
    .get(connection, trackerProject);
  if (raw === undefined) return null;
  const row = mappingRow.parse(raw);
  return {
    connection: row.tracker_connection_id,
    trackerProject: row.tracker_project_id,
    runnerProject: row.runner_project_id,
    agent: row.agent_id,
  };
}

export function saveAutoAssignLabel(
  db: Database,
  input: { workspaceId: WorkspaceId; connection: TrackerConnectionId; labelId: LabelId },
): void {
  db.prepare(
    `INSERT INTO auto_assign_labels (workspace_id, tracker_connection_id, label_id) VALUES (?, ?, ?)
     ON CONFLICT (workspace_id, tracker_connection_id) DO UPDATE SET label_id = excluded.label_id`,
  ).run(input.workspaceId, input.connection, input.labelId);
}

const labelRow = z.object({ label_id: z.string().transform(toLabelId) });

export function getAutoAssignLabel(
  db: Database,
  workspaceId: WorkspaceId,
  connection: TrackerConnectionId,
): LabelId | null {
  const raw = db
    .prepare(
      "SELECT label_id FROM auto_assign_labels WHERE workspace_id = ? AND tracker_connection_id = ?",
    )
    .get(workspaceId, connection);
  return raw === undefined ? null : labelRow.parse(raw).label_id;
}
