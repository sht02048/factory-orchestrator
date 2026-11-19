import type {
  AgentId,
  CodeHostKind,
  LabelId,
  MailboxRef,
  ProviderUsageReading,
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
} from "@ganger/core";
import { USAGE_WINDOW_KINDS, usageLimitsAt } from "@ganger/core";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import type { CodeHostConnectionId, WorkspaceId } from "./ids.js";
import {
  autoAssignLabels,
  codeHostConnections,
  installSettings,
  mappings,
  runnerProjects,
  runners,
  trackerConnections,
  workspaceTrackerProjects,
  workspaces,
} from "./schema.js";
import type { SecretBox } from "./secret-box.js";

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function toJson(value: unknown, what: string): string {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new TypeError(`${what} must be JSON`);
  return text;
}

export interface StoredConnection<Id, Kind> {
  id: Id;
  kind: Kind;
  name: string;
  config: unknown;
  secrets: unknown;
}

export interface ConnectionInput<Id, Kind> {
  id: Id;
  kind: Kind;
  name: string;
  config: unknown;
  secrets: unknown;
}

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

export interface StoredRunner {
  id: RunnerId;
  kind: RunnerKind;
  name: string;
  config: unknown;
  capacity: number;
  online: boolean;
  assignmentBlocked: boolean;
  prerequisites: RunnerPrerequisite[] | null;
  mailbox: MailboxRef | null;
  checkedAt: Date | null;
  checkError: unknown;
  offlineSince: Date | null;
  providerUsage: StoredProviderUsage | null;
  projects: RunnerProject[];
}

export interface StoredProviderUsage {
  readAt: Date;
  reading: ProviderUsageReading;
}

export function saveRunnerCapacity(db: Database, runnerId: RunnerId, capacity: number): boolean {
  const updated = db
    .update(runners)
    .set({ capacity })
    .where(eq(runners.id, runnerId))
    .returning({ id: runners.id })
    .all();
  return updated.length > 0;
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
        offlineSince: input.online
          ? null
          : sql`coalesce(${runners.offlineSince}, ${input.checkedAt.getTime()})`,
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

const storedProviderUsage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("read"),
    providers: z.array(
      z.object({
        provider: z.string(),
        status: z.enum(["ok", "signed-out", "unavailable", "error"]),
        windows: z.array(
          z.object({
            kind: z.enum(USAGE_WINDOW_KINDS),
            usedPercent: z.number(),
            resetsAt: z.number().nullable(),
          }),
        ),
      }),
    ),
  }),
  z.object({ kind: z.literal("unreadable") }),
]);

function providerUsageJson(reading: ProviderUsageReading): string {
  const stored: z.infer<typeof storedProviderUsage> =
    reading.kind === "unreadable"
      ? reading
      : {
          kind: "read",
          providers: reading.providers.map((usage) => ({
            provider: usage.provider,
            status: usage.status,
            windows: usage.windows.map((window) => ({
              kind: window.kind,
              usedPercent: window.usedPercent,
              resetsAt: window.resetsAt === null ? null : window.resetsAt.getTime(),
            })),
          })),
        };
  return toJson(stored, "provider usage");
}

function readProviderUsage(text: string | null, readAt: Date | null): StoredProviderUsage | null {
  if (readAt === null) return null;
  if (text === null) return { readAt, reading: { kind: "unreadable" } };
  let json: unknown;
  try {
    json = parseJson(text);
  } catch {
    return { readAt, reading: { kind: "unreadable" } };
  }
  const parsed = storedProviderUsage.safeParse(json);
  if (!parsed.success || parsed.data.kind === "unreadable") {
    return { readAt, reading: { kind: "unreadable" } };
  }
  return {
    readAt,
    reading: {
      kind: "read",
      providers: parsed.data.providers.map((usage) => ({
        ...usage,
        windows: usage.windows.map((window) => ({
          ...window,
          resetsAt: window.resetsAt === null ? null : new Date(window.resetsAt),
        })),
      })),
    },
  };
}

export function recordProviderUsage(
  db: Database,
  input: { runnerId: RunnerId; readAt: Date; reading: ProviderUsageReading },
): void {
  db.update(runners)
    .set({ providerUsage: providerUsageJson(input.reading), providerUsageReadAt: input.readAt })
    .where(eq(runners.id, input.runnerId))
    .run();
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
      offlineSince: row.offlineSince,
      providerUsage: readProviderUsage(row.providerUsage, row.providerUsageReadAt),
      projects: projects
        .filter((p) => p.runnerId === row.id)
        .map((p) => ({ id: p.projectId, displayName: p.displayName, setupState: p.setupState })),
    }));
}

export function setRunnerMailbox(
  db: Database,
  runnerId: RunnerId,
  mailbox: MailboxRef | null,
): void {
  db.update(runners).set({ mailboxRef: mailbox }).where(eq(runners.id, runnerId)).run();
}

export function listRunnerSnapshots(db: Database, now: Date = new Date()): RunnerSnapshot[] {
  return listRunners(db).map((runner) => ({
    id: runner.id,
    online: runner.online,
    assignmentBlocked: runner.assignmentBlocked,
    capacity: runner.capacity,
    projects: runner.projects.map((p) => p.id),
    usageLimits: usageLimitsAt(runner.providerUsage, now),
  }));
}

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
  model: string | null;
}

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

const INSTALL_SETTINGS_ROW = 1;

export interface InstallAddresses {
  webAddress: string | null;
  webhookAddress: string | null;
}

export interface StoredInstallSettings extends InstallAddresses {
  instanceId: string;
}

export function getInstallSettings(db: Database): StoredInstallSettings {
  const read = () =>
    db
      .select({
        instanceId: installSettings.instanceId,
        webAddress: installSettings.webAddress,
        webhookAddress: installSettings.webhookAddress,
      })
      .from(installSettings)
      .where(eq(installSettings.id, INSTALL_SETTINGS_ROW))
      .get();
  const existing = read();
  if (existing !== undefined) return existing;
  db.insert(installSettings)
    .values({ id: INSTALL_SETTINGS_ROW, instanceId: randomUUID(), updatedAt: new Date() })
    .onConflictDoNothing()
    .run();
  const created = read();
  if (created === undefined) throw new Error("install settings row is missing after insert");
  return created;
}

export function getMcpWriteAllowed(db: Database): boolean {
  return (
    db
      .select({ allowed: installSettings.mcpWriteAllowed })
      .from(installSettings)
      .where(eq(installSettings.id, INSTALL_SETTINGS_ROW))
      .get()?.allowed ?? false
  );
}

export function saveMcpWriteAllowed(db: Database, allowed: boolean, now: Date): void {
  const { instanceId } = getInstallSettings(db);
  db.insert(installSettings)
    .values({ id: INSTALL_SETTINGS_ROW, instanceId, mcpWriteAllowed: allowed, updatedAt: now })
    .onConflictDoUpdate({
      target: installSettings.id,
      set: { mcpWriteAllowed: allowed, updatedAt: now },
    })
    .run();
}

export function saveInstallAddresses(db: Database, input: InstallAddresses, now: Date): void {
  const { instanceId } = getInstallSettings(db);
  db.insert(installSettings)
    .values({ id: INSTALL_SETTINGS_ROW, instanceId, ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: installSettings.id,
      set: { webAddress: input.webAddress, webhookAddress: input.webhookAddress, updatedAt: now },
    })
    .run();
}
