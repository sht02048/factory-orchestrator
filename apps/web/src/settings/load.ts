import { AdapterError, toTrackerConnectionId, toTrackerProjectId } from "@factory/core";
import type { AdapterRegistry, RunnerId, Tracker, TrackerConnectionId } from "@factory/core";
import {
  getAutoAssignLabel,
  getInstallSettings,
  getMapping,
  getRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  listCodeHostConnections,
  listRunners,
  listRuns,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
} from "@factory/db";
import type { Database, SecretBox, StoredTrackerConnection, WorkspaceId } from "@factory/db";
import { z } from "zod";
import { prerequisiteProject } from "../labels";
import { resolveWorkspace } from "../shell/model";
import { KNOWN_AGENTS } from "./model";
import type {
  AddressesView,
  BoundProject,
  Choice,
  ConnectionLabel,
  ConnectionProjects,
  Remote,
  RemoteError,
  RunnerCheckView,
  RunnerSettingsView,
  SettingsPage,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "./model";

/** Settings 가 읽고 쓰는 데 쓰는 것. 테스트는 테스트 DB 와 가짜 어댑터를 등록한 등록표를 넘긴다 */
export interface SettingsContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

/** 트래커 연결의 webhook 수신 경로(routes/api/webhooks/tracker/$connectionId) */
export function webhookPath(connectionId: string): string {
  return `/api/webhooks/tracker/${encodeURIComponent(connectionId)}`;
}

function addressesView(settings: AddressesView): AddressesView {
  return { webAddress: settings.webAddress, webhookAddress: settings.webhookAddress };
}

/**
 * 러너 설정에서 Settings 가 고치는 값. runners/load.ts 와 같은 이름이다(sshTarget, orcaPath).
 * 모양이 다르면 빈 값으로 보인다.
 */
const runnerConfigSchema = z.object({
  sshTarget: z.string().catch(""),
  orcaPath: z.string().catch(""),
});

/** 트래커 연결의 비밀값 중 화면에 알릴 것(있는지만) */
const connectionSecretsSchema = z.object({
  webhookSecret: z.string().min(1).nullish().catch(null),
});

function hasWebhookSecret(secrets: unknown): boolean {
  const parsed = connectionSecretsSchema.safeParse(secrets);
  return parsed.success && typeof parsed.data.webhookSecret === "string";
}

/** 러너 확인 결과(core RunnerHealth 를 JSON 으로 저장한 것). 경계에서 다시 파싱한다 */
const runnerHealthSchema = z.object({
  online: z.boolean(),
  version: z.string().nullable(),
  prerequisites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      satisfied: z.boolean().nullable(),
      hint: z.string().nullable(),
      blocksAssignment: z.boolean(),
    }),
  ),
  error: z.object({ kind: z.string() }).loose().nullable(),
});

const remoteKindSchema = z.object({
  kind: z.enum(["unauthorized", "rate-limited", "not-found", "network"]),
});

/** 어댑터 오류 종류(core TrackerErrorDetail·CodeHostErrorDetail)를 화면의 까닭으로 바꾼다 */
export function remoteErrorOfDetail(detail: unknown): RemoteError {
  const parsed = remoteKindSchema.safeParse(detail);
  return parsed.success ? parsed.data.kind : "network";
}

/** 어댑터 호출에서 던진 오류를 화면의 까닭으로 바꾼다. 설정을 어댑터가 받지 못했으면 invalid 다 */
export function remoteErrorOf(error: unknown): RemoteError {
  if (error instanceof AdapterError) return remoteErrorOfDetail(error.detail);
  if (error instanceof z.ZodError) return "invalid";
  return "network";
}

async function remote<T>(read: () => Promise<ReadonlyArray<T>>): Promise<Remote<T>> {
  try {
    return { ok: true, items: [...(await read())] };
  } catch (error) {
    return { ok: false, error: remoteErrorOf(error) };
  }
}

/** 저장된 트래커 연결로 어댑터를 만든다. 만들지 못하면 null */
export function trackerOf(
  context: SettingsContext,
  connection: StoredTrackerConnection,
): Tracker | null {
  try {
    return context.registry.createTracker(connection.kind, {
      config: connection.config,
      secrets: connection.secrets,
    });
  } catch {
    return null;
  }
}

const toChoice = (item: { id: string; name: string }): Choice => ({ id: item.id, name: item.name });

/**
 * Settings 화면이 보일 값. DB 의 설정과, 이 Workspace 의 트래커 프로젝트·상태·라벨처럼 트래커에서 읽어야 하는
 * 목록을 함께 담는다. 트래커에서 읽지 못한 목록은 까닭과 함께 비워 두고 DB 값은 그대로 보인다.
 * `now` 는 서버가 읽은 때다. 러너 확인 시각의 상대 시간("25분 전")을 여기서 정한다.
 */
export async function loadSettingsPage(
  context: SettingsContext,
  ws: string | undefined,
  now: Date,
): Promise<SettingsPage> {
  const { db, secretBox } = context;
  const connections = listTrackerConnections(db, secretBox);
  const workspaces = listWorkspaces(db);
  const choice = resolveWorkspace(workspaces, ws);
  const current =
    choice.kind === "one" ? workspaces.find((w) => w.id === choice.workspace.id) : undefined;

  const runners = listRunners(db);
  const runnerProjects = new Map<string, Choice>();
  for (const runner of runners) {
    for (const project of runner.projects) {
      if (!runnerProjects.has(project.id))
        runnerProjects.set(project.id, { id: project.id, name: project.displayName });
    }
  }

  const workspace =
    current === undefined
      ? null
      : await loadWorkspaceSettings(context, current, connections, workspaces);

  const agents = new Set<string>(KNOWN_AGENTS);
  for (const bound of workspace?.bound ?? []) {
    if (bound.mapping !== null) agents.add(bound.mapping.agent);
  }

  return {
    workspace,
    install: {
      connections: connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        hasWebhookSecret: hasWebhookSecret(connection.secrets),
        webhookPath: webhookPath(connection.id),
      })),
      githubToken: listCodeHostConnections(db, secretBox).length > 0,
      addresses: addressesView(getInstallSettings(db)),
      runners: runners.map((runner): RunnerSettingsView => {
        const config = runnerConfigSchema.safeParse(runner.config);
        return {
          id: runner.id,
          name: runner.name,
          sshTarget: config.success ? config.data.sshTarget : "",
          orcaPath: config.success ? config.data.orcaPath : "",
          capacity: runner.capacity,
          check: runnerCheckView(db, runner.id, runner.projects, now),
        };
      }),
    },
    runnerProjects: [...runnerProjects.values()],
    agents: [...agents],
  };
}

async function loadWorkspaceSettings(
  context: SettingsContext,
  workspace: { id: WorkspaceId; name: string; maxRunMs: number },
  connections: ReadonlyArray<StoredTrackerConnection>,
  workspaces: ReadonlyArray<{ id: WorkspaceId; name: string }>,
): Promise<WorkspaceSettings> {
  const { db } = context;
  const allBound = listWorkspaceTrackerProjects(db);
  const mine = allBound.filter((p) => p.workspaceId === workspace.id);
  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
  const queued = listRuns(db, { states: ["queued"], workspaceId: workspace.id });
  const trackers = new Map(connections.map((c) => [c.id, trackerOf(context, c)]));
  const connectionChoice = (id: TrackerConnectionId): Choice => ({
    id,
    name: connections.find((c) => c.id === id)?.name ?? id,
  });

  const trackerProjects = await Promise.all(
    connections.map(async (connection): Promise<ConnectionProjects> => {
      const tracker = trackers.get(connection.id) ?? null;
      const listed: Remote<{ id: string; name: string }> =
        tracker === null
          ? { ok: false, error: "invalid" }
          : await remote(() => tracker.listProjects());
      const seen = new Map<string, { id: string; name: string }>();
      for (const project of listed.ok ? listed.items : []) seen.set(project.id, project);
      // 트래커에서 읽지 못했거나 트래커에서 사라졌어도 이 Workspace 에 묶인 것은 보이고 뺄 수 있다.
      for (const project of mine) {
        if (project.connection === connection.id && !seen.has(project.projectId))
          seen.set(project.projectId, { id: project.projectId, name: project.name });
      }
      const projects = [...seen.values()].map((project): TrackerProjectChoice => {
        const bound = allBound.find(
          (p) => p.connection === connection.id && p.projectId === project.id,
        );
        const owner: TrackerProjectChoice["owner"] =
          bound === undefined
            ? { kind: "free" }
            : bound.workspaceId === workspace.id
              ? { kind: "this" }
              : {
                  kind: "other",
                  workspace: {
                    id: bound.workspaceId,
                    name: workspaceName.get(bound.workspaceId) ?? bound.workspaceId,
                  },
                };
        const isMine = owner.kind === "this";
        return {
          id: project.id,
          name: project.name,
          owner,
          mappings:
            isMine && getMapping(db, connection.id, toTrackerProjectId(project.id)) !== null
              ? 1
              : 0,
          queuedRuns: isMine
            ? queued.filter(
                (run) =>
                  run.ticket.connection === connection.id && run.trackerProject === project.id,
              ).length
            : 0,
        };
      });
      return {
        connection: toChoice(connection),
        error: listed.ok ? null : listed.error,
        projects,
      };
    }),
  );

  const bound = await Promise.all(
    mine.map(async (project): Promise<BoundProject> => {
      const tracker = trackers.get(project.connection) ?? null;
      const mapping = getMapping(db, project.connection, project.projectId);
      return {
        connection: connectionChoice(project.connection),
        project: { id: project.projectId, name: project.name },
        mapping:
          mapping === null
            ? null
            : {
                runnerProject: mapping.runnerProject,
                agent: mapping.agent,
                model: mapping.model,
              },
        inProgressStateId: project.inProgressStateId,
        states:
          tracker === null
            ? { ok: false, error: "invalid" }
            : await remote(async () => (await tracker.listStates(project.projectId)).map(toChoice)),
      };
    }),
  );

  const labelConnections = [...new Set(mine.map((p) => p.connection))];
  const labels = await Promise.all(
    labelConnections.map(async (connectionId): Promise<ConnectionLabel> => {
      const tracker = trackers.get(connectionId) ?? null;
      const projects = mine.filter((p) => p.connection === connectionId);
      const read: Remote<Choice> =
        tracker === null
          ? { ok: false, error: "invalid" }
          : await remote(async () => {
              const lists = await Promise.all(projects.map((p) => tracker.listLabels(p.projectId)));
              const unique = new Map<string, Choice>();
              for (const label of lists.flat()) unique.set(label.id, toChoice(label));
              return [...unique.values()].toSorted((a, b) => a.name.localeCompare(b.name));
            });
      return {
        connection: connectionChoice(connectionId),
        labelId: getAutoAssignLabel(db, workspace.id, toTrackerConnectionId(connectionId)),
        labels: read,
      };
    }),
  );

  return {
    general: {
      id: workspace.id,
      name: workspace.name,
      maxRunMinutes: Math.round(workspace.maxRunMs / 60_000),
    },
    trackerProjects,
    bound,
    labels,
  };
}

/**
 * 결과를 기다리는 러너 확인 요청이 있는지. 화면은 기다리는 동안 이것만 다시 읽고(DB만 읽음),
 * 결과가 오면 그때 화면 전체를 다시 읽는다. 전체를 다시 읽으면 트래커 API 를 부르기 때문이다.
 */
export function hasPendingRunnerChecks(db: Database): boolean {
  return listPendingRunnerCheckRequests(db).length > 0;
}

/** 러너 확인 요청과 그 결과(worker 가 씀, Q61) */
function runnerCheckView(
  db: Database,
  runnerId: RunnerId,
  projects: ReadonlyArray<{ id: string; displayName: string }>,
  now: Date,
): RunnerCheckView | null {
  const request = getRunnerCheckRequest(db, runnerId);
  if (request === null) return null;
  switch (request.status) {
    case "pending":
      return { status: "pending", requestedAt: request.requestedAt.toISOString() };
    case "failed":
      return {
        status: "failed",
        completedAt: request.completedAt.toISOString(),
        completedAgoMs: Math.max(0, now.getTime() - request.completedAt.getTime()),
        error: request.error,
      };
    case "done": {
      const completedAt = request.completedAt.toISOString();
      const completedAgoMs = Math.max(0, now.getTime() - request.completedAt.getTime());
      const parsed = runnerHealthSchema.safeParse(request.result);
      if (!parsed.success) return { status: "unreadable", completedAt, completedAgoMs };
      return {
        status: "done",
        completedAt,
        completedAgoMs,
        online: parsed.data.online,
        version: parsed.data.version,
        prerequisites: parsed.data.prerequisites.map((p) => ({
          ...p,
          project: prerequisiteProject(p.id, projects),
        })),
        error: parsed.data.error?.kind ?? null,
      };
    }
  }
}
