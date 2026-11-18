import { randomUUID } from "node:crypto";
import { toTrackerConnectionId, toTrackerProjectId } from "@factory/core";
import {
  getAutoAssignLabel,
  getTrackerConnection,
  getWorkspaceTrackerProject,
  inTransaction,
  getMapping,
  listCodeHostConnections,
  listRunners,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@factory/db";
import type { Database, SecretBox } from "@factory/db";
import { z } from "zod";
import type { SettingsContext } from "../settings/load";
import type { SaveResult } from "../settings/model";
import { isSetupComplete } from "./model";
import type { SetupCounts } from "./model";

export function loadSetupCounts(db: Database, secretBox: SecretBox): SetupCounts {
  const mapped = listWorkspaceTrackerProjects(db).filter(
    (project) => getMapping(db, project.connection, project.projectId) !== null,
  );
  return {
    trackerConnections: listTrackerConnections(db, secretBox).length,
    githubTokens: listCodeHostConnections(db, secretBox).length,
    runners: listRunners(db).length,
    workspaces: listWorkspaces(db).length,
    mappings: mapped.length,
    autoAssignReady: mapped.filter(
      (project) =>
        project.inProgressStateId !== null &&
        getAutoAssignLabel(db, project.workspaceId, project.connection) !== null,
    ).length,
  };
}

export function isOnboardingComplete(db: Database, secretBox: SecretBox): boolean {
  return isSetupComplete(loadSetupCounts(db, secretBox));
}

const id = z.string().trim().min(1);
const name = z.string().trim().min(1).max(200);

export const firstWorkspaceInput = z.object({
  name,
  projects: z.array(z.object({ connectionId: id, projectId: id, name })).max(500),
});

class WorkspaceSetupRejected extends Error {
  readonly reason: "not-found" | "taken";

  constructor(reason: "not-found" | "taken") {
    super(reason);
    this.reason = reason;
  }
}

export function setUpFirstWorkspace(
  context: SettingsContext,
  input: z.infer<typeof firstWorkspaceInput>,
  now: Date,
): SaveResult<"not-found" | "taken"> {
  const { db, secretBox } = context;
  try {
    inTransaction(db, () => {
      const existing = listWorkspaces(db)[0];
      const workspaceId = existing?.id ?? toWorkspaceId(randomUUID());
      saveWorkspace(
        db,
        {
          id: workspaceId,
          name: input.name,
          ...(existing === undefined ? {} : { maxRunMs: existing.maxRunMs }),
        },
        now,
      );
      for (const project of input.projects) {
        const connection = toTrackerConnectionId(project.connectionId);
        if (getTrackerConnection(db, secretBox, connection) === null) {
          throw new WorkspaceSetupRejected("not-found");
        }
        const projectId = toTrackerProjectId(project.projectId);
        const bound = getWorkspaceTrackerProject(db, connection, projectId);
        if (bound !== null) {
          if (bound.workspaceId === workspaceId) continue;
          throw new WorkspaceSetupRejected("taken");
        }
        saveWorkspaceTrackerProject(db, {
          workspaceId,
          connection,
          projectId,
          name: project.name,
          inProgressStateId: null,
        });
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceSetupRejected) return { ok: false, reason: error.reason };
    throw error;
  }
  return { ok: true };
}
