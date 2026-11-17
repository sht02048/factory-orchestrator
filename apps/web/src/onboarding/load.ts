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

/*
 * 온보딩의 DB 읽기·쓰기. 입력 폼과 연결 확인은 Settings(0025)의 server function 을 그대로 쓰고,
 * 여기에는 Settings 에 없는 두 가지만 둔다: 온보딩을 마쳤는지, 첫 Workspace 만들기.
 * 트래커를 부르지 않는다. 루트 라우트가 화면마다 부르기 때문이다.
 */

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

/**
 * 첫 Workspace 를 만든다. Workspace 가 이미 있으면 새로 만들지 않는다(두 번 눌러도 하나다).
 * 이름은 나중에 Settings 에서 바꾼다.
 */
export function createFirstWorkspace(
  db: Database,
  input: z.infer<typeof firstWorkspaceInput>,
  now: Date,
): SaveResult {
  if (listWorkspaces(db).length > 0) return { ok: true };
  saveWorkspace(db, { id: toWorkspaceId(randomUUID()), name: input.name }, now);
  return { ok: true };
}
