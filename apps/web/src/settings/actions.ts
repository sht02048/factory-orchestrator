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
import type { RunnerId, RunnerKind } from "@factory/core";
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
  saveInstallAddresses,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@factory/db";
import type { WorkspaceId } from "@factory/db";
import { z } from "zod";
import { allowedHosts, hostnameOfHostHeader } from "../server/request-guard";
import { remoteErrorOf, remoteErrorOfDetail } from "./load";
import type { SettingsContext } from "./load";
import { MAX_MODEL_LENGTH, MAX_RUN_MINUTES } from "./model";
import type { ConnectionSaveReason, RemoteError, SaveResult } from "./model";

export const RUNNER_KIND: RunnerKind = toRunnerKind("orca");

const id = z.string().trim().min(1);
const MAX_NAME_LENGTH = 200;
const name = z.string().trim().min(1).max(MAX_NAME_LENGTH);

function workspaceOf(context: SettingsContext, ws: string): WorkspaceId | null {
  return listWorkspaces(context.db).find((w) => w.id === ws)?.id ?? null;
}

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
  model: z
    .string()
    .trim()
    .max(MAX_MODEL_LENGTH)
    .refine((value) => value === "" || /^[^\s\p{Cc}-][^\s\p{Cc}]*$/u.test(value))
    .optional(),
});

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
    model: input.model === undefined || input.model === "" ? null : input.model,
  });
  return { ok: true };
}

export const inProgressInput = trackerProjectInput.extend({ stateId: id });

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

const secret = z.string().trim().max(1000);

const DEFAULT_CONNECTION_NAME = "Linear";

function connectionNameOf(organizationName: string | null): string | null {
  const trimmed = organizationName?.trim().slice(0, MAX_NAME_LENGTH).trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export const trackerConnectionInput = z.object({
  id: id.optional(),
  name: name.optional(),
  apiKey: secret,
  webhookSecret: secret,
});

const trackerSecretsSchema = z
  .object({ apiKey: z.string(), webhookSecret: z.string().nullish() })
  .loose();

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

  let organizationName: string | null = null;
  if (input.apiKey !== "") {
    const check = await checkWith<{ ok: true; organizationName: string | null }>(() =>
      context.registry.createTracker(kind, { config, secrets }).checkConnection(),
    );
    if (!check.ok) return { ok: false, reason: check.reason };
    organizationName = connectionNameOf(check.organizationName);
  }
  saveTrackerConnection(
    context.db,
    context.secretBox,
    {
      id: existing?.id ?? toTrackerConnectionId(randomUUID()),
      kind,
      name: input.name ?? existing?.name ?? organizationName ?? DEFAULT_CONNECTION_NAME,
      config,
      secrets,
    },
    now,
  );
  return { ok: true };
}

export const connectionIdInput = z.object({ id });

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

export const githubTokenInput = z.object({ token: z.string().trim().min(1).max(1000) });

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

async function checkWith<C extends { ok: true }>(
  run: () => Promise<C | { ok: false; error: unknown }>,
): Promise<C | { ok: false; reason: RemoteError }> {
  try {
    const result = await run();
    if (result.ok) return result;
    return { ok: false, reason: remoteErrorOfDetail(result.error) };
  } catch (error) {
    return { ok: false, reason: remoteErrorOf(error) };
  }
}

export const runnerInput = z.object({
  id: id.optional(),
  name,
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^-\s\p{Cc}][^\s\p{Cc}]*$/u),
  orcaPath: z.string().trim().min(1).max(1000),
  capacity: z.number().int().min(1).max(100),
});

export function saveRunnerSetting(
  context: SettingsContext,
  input: z.infer<typeof runnerInput>,
  now: Date,
): { ok: true; runnerId: RunnerId } | { ok: false; reason: "not-found" } {
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
      config: {
        ...looseConfig(existing?.config),
        sshTarget: input.sshTarget,
        orcaPath: input.orcaPath,
      },
      capacity: input.capacity,
    },
    now,
  );
  requestRunnerCheck(context.db, runnerId, now);
  return { ok: true, runnerId };
}

function looseConfig(config: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(config);
  return parsed.success ? parsed.data : {};
}

export const runnerIdInput = z.object({ id });

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

export const addressesInput = z.object({
  webAddress: z.string().trim().max(2000),
  webhookAddress: z.string().trim().max(2000),
});

export function normalizeAddress(value: string): string | null | undefined {
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const plain =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  return plain && hostnameOfHostHeader(url.host) !== null ? url.origin : undefined;
}

export type AddressSaveReason = "invalid-web-address" | "invalid-webhook-address" | "locks-out";

export interface RequestOrigin {
  host: string | null;
  bindHost: string | null;
}

export function saveAddresses(
  context: SettingsContext,
  input: z.infer<typeof addressesInput>,
  now: Date,
  from: RequestOrigin,
): SaveResult<AddressSaveReason> {
  const webAddress = normalizeAddress(input.webAddress);
  if (webAddress === undefined) return { ok: false, reason: "invalid-web-address" };
  const webhookAddress = normalizeAddress(input.webhookAddress);
  if (webhookAddress === undefined) return { ok: false, reason: "invalid-webhook-address" };
  const current = hostnameOfHostHeader(from.host);
  if (current !== null) {
    const next = allowedHosts({ bindHost: from.bindHost, webAddress, webhookAddress });
    if (!next.web.has(current)) return { ok: false, reason: "locks-out" };
  }
  saveInstallAddresses(context.db, { webAddress, webhookAddress }, now);
  return { ok: true };
}
