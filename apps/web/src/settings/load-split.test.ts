import {
  AdapterRegistry,
  toLabelId,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { TrackerLabel, TrackerProject, TrackerProjectId, TrackerState } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  latestChangeSeq,
  listChangesAfter,
  migrate,
  openDatabase,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
  trackerReadGeneration,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import { saveMappingState } from "@ganger/app/settings/actions";
import {
  loadBoundProjectReads,
  loadSettingsDb,
  loadSettingsPage,
  loadTrackerProjectChoices,
  loadTrackerProjectLists,
} from "@ganger/app/settings/load";
import { mergeSettingsPage } from "@ganger/app/settings/merge";

const now = new Date("2026-11-20T09:00:00Z");
const commerce = toWorkspaceId("ws-commerce");
const labs = toWorkspaceId("ws-labs");
const connection = toTrackerConnectionId("conn-acme");
const webProject = toTrackerProjectId("tp-web");
const docsProject = toTrackerProjectId("tp-docs");
const appProject = toTrackerProjectId("tp-app");
const secretBox = new SecretBox(new Uint8Array(32).fill(7));

class CountingTracker extends FakeTracker {
  reads = 0;

  override listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    this.reads += 1;
    return super.listProjects();
  }

  override listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    this.reads += 1;
    return super.listStates(projectId);
  }

  override listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    this.reads += 1;
    return super.listLabels(projectId);
  }
}

function setUp() {
  const db = openDatabase(":memory:");
  migrate(db);
  const tracker = new CountingTracker(toTrackerKind("fake"));
  for (const [id, name] of [
    [webProject, "Web"],
    [docsProject, "Docs"],
    [appProject, "App"],
  ] as const) {
    tracker.projects.push({ id, name, url: `https://tracker.example.com/${id}` });
  }
  tracker.states.set(webProject, [
    { id: toTrackerStateId("st-doing"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(webProject, [
    { id: toLabelId("lb-web"), name: "web" },
    { id: toLabelId("lb-auto"), name: "factory" },
  ]);
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: tracker.kind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
  });
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, now);
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, now);
  saveWorkspaceTrackerProject(db, {
    workspaceId: commerce,
    connection,
    projectId: webProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveWorkspaceTrackerProject(db, {
    workspaceId: labs,
    connection,
    projectId: docsProject,
    name: "Docs",
    inProgressStateId: null,
  });
  const registry = new AdapterRegistry().registerTracker({
    kind: tracker.kind,
    create: () => tracker,
  });
  return { db, tracker, context: { db, secretBox, registry } };
}

async function mergedPage(context: ReturnType<typeof setUp>["context"], ws: string) {
  const [projects, reads] = await Promise.all([
    loadTrackerProjectLists(context),
    loadBoundProjectReads(context, ws),
  ]);
  return mergeSettingsPage(loadSettingsDb(context, ws, now), { projects, reads });
}

describe("Settings 로더 나누기(0128)", () => {
  it("DB 부분은 트래커를 읽지 않는다", () => {
    const { tracker, context } = setUp();
    loadSettingsDb(context, commerce, now);
    expect(tracker.reads).toBe(0);
  });

  it.each([commerce, labs, undefined, "all"])(
    "DB 부분과 트래커 부분을 합친 결과가 한 번에 읽은 Settings 와 같다(ws=%s)",
    async (ws) => {
      const { context } = setUp();
      expect(await mergedPage(context, ws ?? "")).toEqual(
        await loadSettingsPage(context, ws ?? "", now),
      );
    },
  );

  it("트래커 부분은 트래커 응답만 담고, 주인·Mapping 수는 DB 부분이 정한다", async () => {
    const { context } = setUp();
    const projects = await loadTrackerProjectLists(context);
    expect(projects).toEqual([
      {
        connection,
        projects: {
          ok: true,
          items: [
            { id: webProject, name: "Web" },
            { id: docsProject, name: "Docs" },
            { id: appProject, name: "App" },
          ],
        },
      },
    ]);
    const owners = (await mergedPage(context, commerce)).workspace?.trackerProjects[0]?.projects;
    expect(owners?.map((project) => [project.id, project.owner.kind])).toEqual([
      [webProject, "this"],
      [docsProject, "other"],
      [appProject, "free"],
    ]);
  });

  it("Mapping 을 저장하면 DB 부분만 다시 읽어도 Mapping 수가 바뀌고 트래커는 읽지 않는다", async () => {
    const { tracker, context } = setUp();
    const [projects, reads] = await Promise.all([
      loadTrackerProjectLists(context),
      loadBoundProjectReads(context, commerce),
    ]);
    const before = mergeSettingsPage(loadSettingsDb(context, commerce, now), { projects, reads });
    expect(before.workspace?.trackerProjects[0]?.projects[0]?.mappings).toBe(0);
    const trackerReads = tracker.reads;

    expect(
      saveMappingState(context, {
        ws: commerce,
        connectionId: connection,
        projectId: webProject,
        agentId: "claude",
        repos: [{ runnerProjectId: "fake:acme/web", isDefault: true, labelId: null }],
      }),
    ).toEqual({ ok: true });
    const after = mergeSettingsPage(loadSettingsDb(context, commerce, now), { projects, reads });

    expect(after.workspace?.trackerProjects[0]?.projects[0]?.mappings).toBe(1);
    expect(after.workspace?.bound[0]?.mapping?.agent).toBe("claude");
    expect(tracker.reads).toBe(trackerReads);
  });

  it("Mapping 저장은 settings 변경 기록만 남기고, 트래커 서버 캐시 세대는 올린다", () => {
    const { db, context } = setUp();
    const seq = latestChangeSeq(db);
    const generation = trackerReadGeneration(db, connection);
    saveMappingState(context, {
      ws: commerce,
      connectionId: connection,
      projectId: webProject,
      agentId: "claude",
      repos: [{ runnerProjectId: "fake:acme/web", isDefault: true, labelId: null }],
    });
    expect(listChangesAfter(db, seq).map((change) => change.kind)).toEqual(["settings"]);
    expect(trackerReadGeneration(db, connection)).toBe(generation + 1);
  });

  it("라벨은 프로젝트마다 이름순으로 담고, 연결의 라벨 목록은 합쳐서 보인다", async () => {
    const { context } = setUp();
    const reads = await loadBoundProjectReads(context, commerce);
    expect(reads).toEqual([
      {
        connection,
        projectId: webProject,
        states: { ok: true, items: [{ id: "st-doing", name: "In Progress" }] },
        labels: {
          ok: true,
          items: [
            { id: "lb-auto", name: "factory" },
            { id: "lb-web", name: "web" },
          ],
        },
      },
    ]);
    expect((await mergedPage(context, commerce)).workspace?.labels[0]?.labels).toEqual(
      reads[0]?.labels,
    );
  });

  it("아직 읽지 않은 트래커 부분은 실패가 아니라 빈 목록으로 합친다", () => {
    const { context } = setUp();
    const page = mergeSettingsPage(loadSettingsDb(context, commerce, now), {
      projects: [],
      reads: [],
    });
    expect(page.workspace?.trackerProjects[0]).toMatchObject({
      error: null,
      projects: [{ id: webProject, owner: { kind: "this" } }],
    });
    expect(page.workspace?.bound[0]?.states).toEqual({ ok: true, items: [] });
  });

  it("온보딩의 트래커 프로젝트 고르기는 Workspace 가 없으면 묶인 프로젝트를 모두 다른 주인으로 본다", async () => {
    const { context } = setUp();
    const choices = await loadTrackerProjectChoices(context, null);
    expect(choices[0]?.projects.map((project) => [project.id, project.owner.kind])).toEqual([
      [webProject, "other"],
      [docsProject, "other"],
      [appProject, "free"],
    ]);
  });
});
