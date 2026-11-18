import type { WorkspaceId } from "@ganger/db";

export const WORKSPACE_ITEMS = ["general", "projects", "mapping", "progress", "label"] as const;
export const INSTALL_ITEMS = ["connections", "github", "runners", "addresses"] as const;
export type WorkspaceItem = (typeof WORKSPACE_ITEMS)[number];
export type InstallItem = (typeof INSTALL_ITEMS)[number];
export type SettingsItem = WorkspaceItem | InstallItem;

export function isSettingsItem(value: string | undefined): value is SettingsItem {
  return (
    value !== undefined &&
    (WORKSPACE_ITEMS.some((item) => item === value) || INSTALL_ITEMS.some((item) => item === value))
  );
}

export type RemoteError = "unauthorized" | "rate-limited" | "not-found" | "network" | "invalid";

export type Remote<T> = { ok: true; items: T[] } | { ok: false; error: RemoteError };

export interface Choice {
  id: string;
  name: string;
}

export interface WorkspaceGeneral {
  id: WorkspaceId;
  name: string;
  maxRunMinutes: number;
}

export type ProjectOwner =
  | { kind: "free" }
  | { kind: "this" }
  | { kind: "other"; workspace: Choice };

export interface TrackerProjectChoice {
  id: string;
  name: string;
  owner: ProjectOwner;
  mappings: number;
  queuedRuns: number;
}

export interface ConnectionProjects {
  connection: Choice;
  error: RemoteError | null;
  projects: TrackerProjectChoice[];
}

export interface BoundProject {
  connection: Choice;
  project: Choice;
  mapping: { runnerProject: string; agent: string; model: string | null } | null;
  inProgressStateId: string | null;
  states: Remote<Choice>;
}

export interface ConnectionLabel {
  connection: Choice;
  labelId: string | null;
  labels: Remote<Choice>;
}

export interface WorkspaceSettings {
  general: WorkspaceGeneral;
  trackerProjects: ConnectionProjects[];
  bound: BoundProject[];
  labels: ConnectionLabel[];
}

export interface TrackerConnectionView {
  id: string;
  name: string;
  hasWebhookSecret: boolean;
  webhookPath: string;
}

export interface PrerequisiteView {
  id: string;
  name: string;
  satisfied: boolean | null;
  hint: string | null;
  project: string | null;
  blocksAssignment: boolean;
}

export type RunnerCheckView =
  | { status: "pending"; requestedAt: string }
  | { status: "failed"; completedAt: string; completedAgoMs: number; error: string }
  | {
      status: "done";
      completedAt: string;
      completedAgoMs: number;
      online: boolean;
      version: string | null;
      prerequisites: PrerequisiteView[];
      error: string | null;
    }
  | { status: "unreadable"; completedAt: string; completedAgoMs: number };

export interface RunnerSettingsView {
  id: string;
  name: string;
  sshTarget: string;
  orcaPath: string;
  capacity: number;
  check: RunnerCheckView | null;
}

export interface AddressesView {
  webAddress: string | null;
  webhookAddress: string | null;
}

export interface InstallSettings {
  connections: TrackerConnectionView[];
  githubToken: boolean;
  runners: RunnerSettingsView[];
  addresses: AddressesView;
}

export interface SettingsPage {
  workspace: WorkspaceSettings | null;
  install: InstallSettings;
  runnerProjects: Choice[];
  agents: string[];
}

export const MAX_RUN_MINUTES = 7 * 24 * 60;

export const RUNNER_CHECK_POLL_MS = 3000;
export const RUNNER_CHECK_POLL_LIMIT_MS = 2 * 60 * 1000;

export const KNOWN_AGENTS = ["claude", "codex"] as const;

export const MAX_MODEL_LENGTH = 200;

export type SaveResult<R extends string = never> = { ok: true } | { ok: false; reason: R };

export type ConnectionSaveReason = RemoteError | "missing-key" | "not-found";
