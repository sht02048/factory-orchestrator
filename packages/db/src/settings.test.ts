import { toTicketKey, toTrackerProjectId } from "@factory/core";
import { describe, expect, it } from "vitest";
import { toWorkspaceId } from "./ids.js";
import { assignRun, changeRunState, getRun, listRuns } from "./runs.js";
import {
  getMapping,
  listWorkspaceTrackerProjects,
  removeWorkspaceTrackerProject,
  saveWorkspace,
  saveWorkspaceTrackerProject,
} from "./settings.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const otherWorkspace = toWorkspaceId("ws-2");
const otherProject = toTrackerProjectId("tp-2");

function seedTwoWorkspaces() {
  const db = seededDatabase();
  saveWorkspace(db, { id: otherWorkspace, name: "Labs" });
  saveWorkspaceTrackerProject(db, {
    workspaceId: otherWorkspace,
    connection,
    projectId: otherProject,
    name: "Lab",
    inProgressStateId: null,
  });
  return db;
}

describe("listWorkspaceTrackerProjects", () => {
  it("Workspace를 주지 않으면 모든 Workspace의 트래커 프로젝트를 돌려준다", () => {
    const db = seedTwoWorkspaces();
    expect(listWorkspaceTrackerProjects(db)).toEqual([
      {
        workspaceId: otherWorkspace,
        connection,
        projectId: otherProject,
        name: "Lab",
        inProgressStateId: null,
      },
      { workspaceId, connection, projectId: trackerProject, name: "Web", inProgressStateId: null },
    ]);
  });

  it("Workspace를 주면 그 Workspace 것만 돌려준다", () => {
    const db = seedTwoWorkspaces();
    expect(listWorkspaceTrackerProjects(db, otherWorkspace).map((p) => p.projectId)).toEqual([
      otherProject,
    ]);
  });
});

describe("removeWorkspaceTrackerProject", () => {
  it("빼면 Mapping은 함께 지워지지만 런 기록은 남는다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "runner-1", capacity: 2, online: true, projects: [repoA] });
    const ticket = (key: string) => ({ connection, key: toTicketKey(key) });
    const assign = (key: string) => {
      const result = assignRun(db, {
        ticket: ticket(key),
        trackerProject,
        runnerProject: repoA,
        agent,
      });
      if (!result.ok) throw new Error(result.reason);
      return result.run.id;
    };
    const ended = assign("ENG-1");
    const ok = changeRunState(db, ended, {
      to: "ended",
      agentResult: "canceled",
      prState: "none",
    });
    expect(ok.ok).toBe(true);
    const queued = assign("ENG-2");

    expect(
      removeWorkspaceTrackerProject(db, { workspaceId, connection, projectId: trackerProject }),
    ).toBe(true);

    expect(listWorkspaceTrackerProjects(db, workspaceId)).toEqual([]);
    expect(getMapping(db, connection, trackerProject)).toBeNull();
    expect(listRuns(db).map((run) => run.id)).toEqual([ended, queued]);
    expect(getRun(db, ended)).toMatchObject({ state: "ended", trackerProject, workspaceId });
    expect(getRun(db, queued)).toMatchObject({ state: "queued", trackerProject, workspaceId });
  });

  it("다른 Workspace에 묶인 트래커 프로젝트는 빼지 않는다", () => {
    const db = seedTwoWorkspaces();
    expect(
      removeWorkspaceTrackerProject(db, { workspaceId, connection, projectId: otherProject }),
    ).toBe(false);
    expect(listWorkspaceTrackerProjects(db, otherWorkspace)).toHaveLength(1);
  });
});
