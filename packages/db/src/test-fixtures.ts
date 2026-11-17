import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toAgentId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
} from "@factory/core";
import type { RunnerId, RunnerProjectId } from "@factory/core";
import { openDatabase } from "./database.js";
import type { Database } from "./database.js";
import { toWorkspaceId } from "./ids.js";
import { migrate } from "./migrate.js";
import { SecretBox } from "./secret-box.js";
import {
  recordRunnerCheck,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
} from "./settings.js";

export const KEY = new Uint8Array(32).fill(7);
export const connection = toTrackerConnectionId("conn-1");
export const trackerProject = toTrackerProjectId("tp-1");
export const workspaceId = toWorkspaceId("ws-1");
export const repoA = toRunnerProjectId("github:acme/a");
export const repoB = toRunnerProjectId("github:acme/b");
export const agent = toAgentId("claude");

/** 임시 디렉터리의 DB 파일. 테스트가 끝나면 `cleanup`을 부른다. */
export function tempDatabasePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "factory-db-"));
  return {
    path: join(dir, "data", "factory.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 마이그레이션한 메모리 DB에 트래커 연결 하나, Workspace 하나, 매핑 하나를 넣는다. */
export function seededDatabase(): Database {
  const db = openDatabase(":memory:");
  migrate(db);
  saveTrackerConnection(db, new SecretBox(KEY), {
    id: connection,
    kind: toTrackerKind("fake"),
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject: repoA, agent });
  return db;
}

export function addRunner(
  db: Database,
  input: { id: string; capacity: number; online: boolean; projects: RunnerProjectId[] },
): RunnerId {
  const id = toRunnerId(input.id);
  saveRunner(db, {
    id,
    kind: toRunnerKind("fake"),
    name: input.id,
    config: {},
    capacity: input.capacity,
  });
  recordRunnerCheck(db, {
    runnerId: id,
    online: input.online,
    checkedAt: new Date(0),
    error: null,
    projects: input.projects.map((p) => ({ id: p, displayName: p, setupState: "ready" })),
  });
  return id;
}
