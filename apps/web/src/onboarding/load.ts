import { randomUUID } from "node:crypto";
import {
  getAutoAssignLabel,
  getMapping,
  listCodeHostConnections,
  listRunners,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  saveWorkspace,
  toWorkspaceId,
} from "@factory/db";
import type { Database, SecretBox } from "@factory/db";
import { z } from "zod";
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

export const firstWorkspaceInput = z.object({ name: z.string().trim().min(1).max(200) });

export function createFirstWorkspace(
  db: Database,
  input: z.infer<typeof firstWorkspaceInput>,
  now: Date,
): SaveResult {
  if (listWorkspaces(db).length > 0) return { ok: true };
  saveWorkspace(db, { id: toWorkspaceId(randomUUID()), name: input.name }, now);
  return { ok: true };
}
