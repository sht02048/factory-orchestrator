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
  migrate,
  openDatabase,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import { loadSettingsPage } from "@ganger/app/settings/load";

const now = new Date("2026-11-19T09:00:00Z");
const workspace = toWorkspaceId("ws-commerce");
const connection = toTrackerConnectionId("conn-acme");
const webProject = toTrackerProjectId("tp-web");
const secretBox = new SecretBox(new Uint8Array(32).fill(7));

type TrackerRead = "projects" | "states" | "labels";

class RecordingTracker extends FakeTracker {
  readonly log: string[] = [];
  failing: TrackerRead | null = null;

  private async read<T>(name: TrackerRead, value: () => Promise<T>): Promise<T> {
    this.log.push(`start ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.log.push(`end ${name}`);
    if (this.failing === name) throw new Error(`${name} failed`);
    return value();
  }

  override listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    return this.read("projects", () => super.listProjects());
  }

  override listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    return this.read("states", () => super.listStates(projectId));
  }

  override listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    return this.read("labels", () => super.listLabels(projectId));
  }
}

function setUp() {
  const db = openDatabase(":memory:");
  migrate(db);
  const tracker = new RecordingTracker(toTrackerKind("fake"));
  tracker.projects.push({ id: webProject, name: "Web", url: "https://tracker.example.com/web" });
  tracker.states.set(webProject, [
    { id: toTrackerStateId("st-doing"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(webProject, [{ id: toLabelId("lb-auto"), name: "factory" }]);
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: tracker.kind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
  });
  saveWorkspace(db, { id: workspace, name: "Acme Commerce" }, now);
  saveWorkspaceTrackerProject(db, {
    workspaceId: workspace,
    connection,
    projectId: webProject,
    name: "Web",
    inProgressStateId: null,
  });
  const registry = new AdapterRegistry().registerTracker({
    kind: tracker.kind,
    create: () => tracker,
  });
  return { tracker, context: { db, secretBox, registry } };
}

describe("Settings 로더의 트래커 읽기(0117)", () => {
  it("프로젝트·상태·라벨을 차례로 기다리지 않고 한꺼번에 읽는다", async () => {
    const { tracker, context } = setUp();
    await loadSettingsPage(context, workspace, now);
    const firstEnd = tracker.log.findIndex((entry) => entry.startsWith("end"));
    expect(tracker.log.slice(0, firstEnd).toSorted()).toEqual([
      "start labels",
      "start projects",
      "start states",
    ]);
  });

  it.each<TrackerRead>(["projects", "states", "labels"])(
    "%s 읽기가 실패해도 그 묶음만 실패로 담고 나머지는 보인다",
    async (failing) => {
      const { tracker, context } = setUp();
      tracker.failing = failing;
      const settings = (await loadSettingsPage(context, workspace, now)).workspace;

      const projects = settings?.trackerProjects[0];
      const states = settings?.bound[0]?.states;
      const labels = settings?.labels[0]?.labels;
      expect(projects?.error).toBe(failing === "projects" ? "network" : null);
      expect(projects?.projects.map((project) => project.id)).toEqual([webProject]);
      expect(states).toEqual(
        failing === "states"
          ? { ok: false, error: "network" }
          : { ok: true, items: [{ id: "st-doing", name: "In Progress" }] },
      );
      expect(labels).toEqual(
        failing === "labels"
          ? { ok: false, error: "network" }
          : { ok: true, items: [{ id: "lb-auto", name: "factory" }] },
      );
    },
  );
});
