import { randomUUID } from "node:crypto";
import {
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type { ConnectionCheck, RunnerKind } from "@factory/core";
import {
  getTrackerConnection,
  getWorkspaceTrackerProject,
  listCodeHostConnections,
  listRunners,
  listWorkspaces,
  removeWorkspaceTrackerProject,
  requestRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@factory/db";
import type { WorkspaceId } from "@factory/db";
import { z } from "zod";
import { remoteErrorOf, remoteErrorOfDetail } from "./load";
import type { SettingsContext } from "./load";
import { MAX_RUN_MINUTES } from "./model";
import type { ConnectionSaveReason, RemoteError, SaveResult } from "./model";

/*
 * Settings 의 저장과 연결 확인. 입력은 server function 경계에서 zod 로 파싱한 값이다.
 * web 은 ssh 를 쓰지 않는다. 러너 확인은 DB 에 요청을 남기고 worker 가 결과를 쓴다(Q61).
 * Linear·GitHub 연결 확인은 어댑터로 바로 한다.
 */

/** 1단계 러너 종류(Orca, ADR 0008). 설정은 { sshTarget, orcaPath } 다(runner-orca, 0013) */
export const RUNNER_KIND: RunnerKind = toRunnerKind("orca");

const id = z.string().trim().min(1);
const name = z.string().trim().min(1).max(200);

function workspaceOf(context: SettingsContext, ws: string): WorkspaceId | null {
  return listWorkspaces(context.db).find((w) => w.id === ws)?.id ?? null;
}

// ---------- 이 Workspace ----------

export const generalInput = z.object({
  ws: id,
  name,
  maxRunMinutes: z.number().int().min(1).max(MAX_RUN_MINUTES),
});

export function saveGeneral(
  context: SettingsContext,
  input: z.infer<typeof generalInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return { ok: false, reason: "not-found" };
  saveWorkspace(context.db, {
    id: workspaceId,
    name: input.name,
    maxRunMs: input.maxRunMinutes * 60_000,
  });
  return { ok: true };
}

export const trackerProjectInput = z.object({
  ws: id,
  connectionId: id,
  projectId: id,
});

export const addTrackerProjectInput = trackerProjectInput.extend({ name });

/**
 * 트래커 프로젝트를 이 Workspace 에 넣는다. 다른 Workspace 에 묶여 있으면 넣지 않는다(ADR 0006).
 * 이미 이 Workspace 에 있으면 "In Progress" 상태를 그대로 둔다.
 */
export function addTrackerProject(
  context: SettingsContext,
  input: z.infer<typeof addTrackerProjectInput>,
): SaveResult<"not-found" | "taken"> {
  const workspaceId = workspaceOf(context, input.ws);
  const connection = toTrackerConnectionId(input.connectionId);
  if (
    workspaceId === null ||
    getTrackerConnection(context.db, context.secretBox, connection) === null
  ) {
    return { ok: false, reason: "not-found" };
  }
  const projectId = toTrackerProjectId(input.projectId);
  const existing = getWorkspaceTrackerProject(context.db, connection, projectId);
  if (existing !== null) {
    return existing.workspaceId === workspaceId ? { ok: true } : { ok: false, reason: "taken" };
  }
  const saved = saveWorkspaceTrackerProject(context.db, {
    workspaceId,
    connection,
    projectId,
    name: input.name,
    inProgressStateId: null,
  });
  return saved ? { ok: true } : { ok: false, reason: "taken" };
}

/** 트래커 프로젝트를 이 Workspace 에서 뺀다. Mapping 도 함께 지워지고 런 기록은 남는다 */
export function removeTrackerProject(
  context: SettingsContext,
  input: z.infer<typeof trackerProjectInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return { ok: false, reason: "not-found" };
  const removed = removeWorkspaceTrackerProject(context.db, {
    workspaceId,
    connection: toTrackerConnectionId(input.connectionId),
    projectId: toTrackerProjectId(input.projectId),
  });
  return removed ? { ok: true } : { ok: false, reason: "not-found" };
}

/** 이 Workspace 에 묶인 트래커 프로젝트. 아니면 null */
function boundProject(context: SettingsContext, input: z.infer<typeof trackerProjectInput>) {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return null;
  const project = getWorkspaceTrackerProject(
    context.db,
    toTrackerConnectionId(input.connectionId),
    toTrackerProjectId(input.projectId),
  );
  return project?.workspaceId === workspaceId ? project : null;
}

export const mappingInput = trackerProjectInput.extend({
  runnerProjectId: id,
  agentId: id,
});

/** Mapping 을 저장한다. 러너는 고르지 않는다(Q53) */
export function saveMappingSetting(
  context: SettingsContext,
  input: z.infer<typeof mappingInput>,
): SaveResult<"not-found"> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  saveMapping(context.db, {
    connection: project.connection,
    trackerProject: project.projectId,
    runnerProject: toRunnerProjectId(input.runnerProjectId),
    agent: toAgentId(input.agentId),
  });
  return { ok: true };
}

export const inProgressInput = trackerProjectInput.extend({ stateId: id });

/** 런이 시작할 때 티켓을 옮길 "In Progress" 상태(Q41) */
export function saveInProgressState(
  context: SettingsContext,
  input: z.infer<typeof inProgressInput>,
): SaveResult<"not-found"> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  saveWorkspaceTrackerProject(context.db, {
    ...project,
    inProgressStateId: toTrackerStateId(input.stateId),
  });
  return { ok: true };
}

export const labelInput = z.object({ ws: id, connectionId: id, labelId: id });

export function saveLabel(
  context: SettingsContext,
  input: z.infer<typeof labelInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  const connection = toTrackerConnectionId(input.connectionId);
  if (
    workspaceId === null ||
    getTrackerConnection(context.db, context.secretBox, connection) === null
  ) {
    return { ok: false, reason: "not-found" };
  }
  saveAutoAssignLabel(context.db, {
    workspaceId,
    connection,
    labelId: toLabelId(input.labelId),
  });
  return { ok: true };
}

// ---------- 설치 전체: 트래커 연결 ----------

/** 비밀값 칸. 비우면 저장된 값을 그대로 둔다 */
const secret = z.string().trim().max(1000);

export const trackerConnectionInput = z.object({
  /** 없으면 새 연결 */
  id: id.optional(),
  name,
  apiKey: secret,
  webhookSecret: secret,
});

/** 트래커 연결의 비밀값. 1단계 트래커 어댑터가 받는 모양이다(API 키, webhook signing secret) */
const trackerSecretsSchema = z
  .object({ apiKey: z.string(), webhookSecret: z.string().nullish() })
  .loose();

/**
 * 트래커 연결을 저장한다. 새 API 키는 트래커에 닿는지 먼저 확인하고, 확인에 실패하면 저장하지 않는다.
 * 비운 비밀값 칸은 저장된 값을 그대로 둔다. 새 연결의 종류는 등록한 트래커 종류 중 첫째다(1단계는 Linear 하나).
 */
export async function saveTrackerConnectionSetting(
  context: SettingsContext,
  input: z.infer<typeof trackerConnectionInput>,
  now: Date,
): Promise<SaveResult<ConnectionSaveReason>> {
  const existing =
    input.id === undefined
      ? null
      : getTrackerConnection(context.db, context.secretBox, toTrackerConnectionId(input.id));
  if (input.id !== undefined && existing === null) return { ok: false, reason: "not-found" };

  const kind = existing?.kind ?? context.registry.kinds().trackers[0];
  if (kind === undefined) return { ok: false, reason: "invalid" };
  const stored = existing === null ? null : trackerSecretsSchema.safeParse(existing.secrets);
  const previous = stored?.success === true ? stored.data : null;
  const apiKey = input.apiKey === "" ? previous?.apiKey : input.apiKey;
  if (apiKey === undefined || apiKey === "") return { ok: false, reason: "missing-key" };
  const webhookSecret =
    input.webhookSecret === "" ? (previous?.webhookSecret ?? null) : input.webhookSecret;
  const secrets = { ...previous, apiKey, webhookSecret };
  const config = existing?.config ?? {};

  if (input.apiKey !== "") {
    const check = await checkWith(() =>
      context.registry.createTracker(kind, { config, secrets }).checkConnection(),
    );
    if (!check.ok) return { ok: false, reason: check.reason };
  }
  saveTrackerConnection(
    context.db,
    context.secretBox,
    {
      id: existing?.id ?? toTrackerConnectionId(randomUUID()),
      kind,
      name: input.name,
      config,
      secrets,
    },
    now,
  );
  return { ok: true };
}

export const connectionIdInput = z.object({ id });

/** 저장한 트래커 연결이 지금도 닿는지 어댑터로 확인한다 */
export async function checkTrackerConnection(
  context: SettingsContext,
  input: z.infer<typeof connectionIdInput>,
): Promise<SaveResult<ConnectionSaveReason>> {
  const connection = getTrackerConnection(
    context.db,
    context.secretBox,
    toTrackerConnectionId(input.id),
  );
  if (connection === null) return { ok: false, reason: "not-found" };
  return checkWith(() =>
    context.registry
      .createTracker(connection.kind, { config: connection.config, secrets: connection.secrets })
      .checkConnection(),
  );
}

// ---------- 설치 전체: GitHub 토큰 ----------

export const githubTokenInput = z.object({ token: z.string().trim().min(1).max(1000) });

/**
 * GitHub 토큰을 확인한 뒤 저장한다. 연결은 설치에 하나다. 이미 있으면 그 연결의 토큰을 바꾼다.
 * 확인은 토큰이 맞고 GitHub 에 닿는지만 본다. CI 를 읽을 권한은 저장소마다 달라 여기서 알 수 없다(Q79).
 */
export async function saveGitHubToken(
  context: SettingsContext,
  input: z.infer<typeof githubTokenInput>,
  now: Date,
): Promise<SaveResult<RemoteError>> {
  const existing = listCodeHostConnections(context.db, context.secretBox)[0];
  const kind = existing?.kind ?? context.registry.kinds().codeHosts[0];
  if (kind === undefined) return { ok: false, reason: "invalid" };
  const config = existing?.config ?? {};
  const secrets = { token: input.token };
  const check = await checkWith(() =>
    context.registry.createCodeHost(kind, { config, secrets }).checkConnection(),
  );
  if (!check.ok) return check;
  saveCodeHostConnection(
    context.db,
    context.secretBox,
    {
      id: existing?.id ?? toCodeHostConnectionId(kind),
      kind,
      name: existing?.name ?? kind,
      config,
      secrets,
    },
    now,
  );
  return { ok: true };
}

/** 저장한 GitHub 토큰이 지금도 맞는지 확인한다 */
export async function checkGitHubToken(
  context: SettingsContext,
): Promise<SaveResult<RemoteError | "not-found">> {
  const connection = listCodeHostConnections(context.db, context.secretBox)[0];
  if (connection === undefined) return { ok: false, reason: "not-found" };
  return checkWith(() =>
    context.registry
      .createCodeHost(connection.kind, { config: connection.config, secrets: connection.secrets })
      .checkConnection(),
  );
}

async function checkWith(
  run: () => Promise<ConnectionCheck<{ kind: string }>>,
): Promise<SaveResult<RemoteError>> {
  try {
    const result = await run();
    if (result.ok) return { ok: true };
    return { ok: false, reason: remoteErrorOfDetail(result.error) };
  } catch (error) {
    return { ok: false, reason: remoteErrorOf(error) };
  }
}

// ---------- 설치 전체: 러너 ----------

export const runnerInput = z.object({
  /** 없으면 새 러너 */
  id: id.optional(),
  name,
  /**
   * ssh 에 그대로 넘기는 대상. "-" 로 시작하면 ssh 옵션으로 읽히므로(-oProxyCommand 등) 거절하고,
   * 공백·제어 문자도 받지 않는다.
   */
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^-\s][^\s]*$/),
  orcaPath: z.string().trim().min(1).max(1000),
  capacity: z.number().int().min(1).max(100),
});

/**
 * 러너를 저장하고 러너 확인을 요청한다. ssh 는 web 이 아니라 worker 가 쓴다(Q61).
 * 저장한 러너의 id 를 돌려준다.
 */
export function saveRunnerSetting(
  context: SettingsContext,
  input: z.infer<typeof runnerInput>,
  now: Date,
): { ok: true; runnerId: string } | { ok: false; reason: "not-found" } {
  const existing =
    input.id === undefined ? undefined : listRunners(context.db).find((r) => r.id === input.id);
  if (input.id !== undefined && existing === undefined) return { ok: false, reason: "not-found" };
  const runnerId = existing?.id ?? toRunnerId(randomUUID());
  saveRunner(
    context.db,
    {
      id: runnerId,
      kind: existing?.kind ?? RUNNER_KIND,
      name: input.name,
      config: { sshTarget: input.sshTarget, orcaPath: input.orcaPath },
      capacity: input.capacity,
    },
    now,
  );
  requestRunnerCheck(context.db, runnerId, now);
  return { ok: true, runnerId };
}

export const runnerIdInput = z.object({ id });

/** 러너 확인을 요청한다. 결과는 worker 가 쓰고 화면이 다시 읽는다(Q61) */
export function requestRunnerCheckSetting(
  context: SettingsContext,
  input: z.infer<typeof runnerIdInput>,
  now: Date,
): SaveResult<"not-found"> {
  const runner = listRunners(context.db).find((r) => r.id === input.id);
  if (runner === undefined) return { ok: false, reason: "not-found" };
  requestRunnerCheck(context.db, runner.id, now);
  return { ok: true };
}
