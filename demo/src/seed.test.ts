import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { highestUsage, summarizeRunOutcome } from "@ganger/core";
import {
  SecretBox,
  getAutoAssignLabel,
  getInstallSettings,
  getMapping,
  listCodeHostConnections,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  listRunPermissionWaits,
  listRunQuestions,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  listRunsWithRecords,
  migrate,
  openDatabase,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { createWorker } from "@ganger/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUNNER_PROJECTS } from "./fixtures.js";
import { hydrateWorld } from "./hydrate.js";
import { HISTORY_DAYS, seedDemo } from "./seed.js";
import { DemoWorld } from "./world.js";

const now = new Date();
const box = new SecretBox(new Uint8Array(32).fill(5));

let dir: string;
let dbPath: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-dev-seed-"));
  dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("seedDemo", () => {
  it("온보딩을 마친 설치를 만든다", async () => {
    await seedDemo(db, box, new DemoWorld(() => now), now);
    expect(listTrackerConnections(db, box)).toHaveLength(2);
    expect(listCodeHostConnections(db, box)).toHaveLength(1);
    expect(listWorkspaces(db)).toHaveLength(2);
    expect(getInstallSettings(db)).toMatchObject({
      webAddress: "https://orchestrator.example.ts.net",
      webhookAddress: "https://hooks.example.com",
    });
    for (const project of listWorkspaceTrackerProjects(db)) {
      expect(getMapping(db, project.connection, project.projectId)).not.toBeNull();
      expect(project.inProgressStateId).not.toBeNull();
      expect(getAutoAssignLabel(db, project.workspaceId, project.connection)).not.toBeNull();
    }
  });

  it("런의 모든 상태와 요약 결과 셋, 질문·권한 대기, 남긴 워크트리를 만든다", async () => {
    const seeded = await seedDemo(db, box, new DemoWorld(() => now), now);
    const runs = listRuns(db);
    expect(new Set(runs.map((run) => run.state))).toEqual(
      new Set(["queued", "running", "waiting-for-input", "paused", "disconnected", "ended"]),
    );
    const outcomes = new Set(
      runs.flatMap((run) => (run.state === "ended" ? [summarizeRunOutcome(run).outcome] : [])),
    );
    expect(outcomes).toEqual(new Set(["succeeded", "failed", "canceled"]));
    const kept = listRunsWithRecords(db, { states: ["ended"] }).filter(
      ({ run, records }) =>
        run.state === "ended" &&
        records.worktreeRemovedAt === null &&
        (records.worktreeKept !== null || summarizeRunOutcome(run).worktree === "operator-decides"),
    );
    expect(kept.map(({ records }) => records.worktreeKept)).toEqual(
      expect.arrayContaining(["unpushed-commits", null]),
    );
    expect(kept).toHaveLength(2);
    expect(listRunQuestions(db, seeded.question).filter((q) => q.answer === null)).toHaveLength(1);
    expect(listRunPermissionWaits(db, seeded.permission)).toHaveLength(1);
    const active = new Set(runs.filter((r) => r.state !== "ended").map((r) => r.ticket.key));
    expect(runs.filter((r) => r.state === "ended" && active.has(r.ticket.key))).toEqual([]);
  });

  it("지난 2주에 걸친 끝난 런을 만든다", async () => {
    await seedDemo(db, box, new DemoWorld(() => now), now);
    const ended = listRuns(db, { states: ["ended"] });
    expect(ended.length).toBeGreaterThan(40);
    const days = new Set(ended.map((run) => run.assignedAt.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(HISTORY_DAYS - 1);
    expect(ended.every((run) => run.assignedAt.getTime() <= now.getTime())).toBe(true);
  });

  it("러너 셋: Online, 저장소 하나의 push 실패, Offline", async () => {
    await seedDemo(db, box, new DemoWorld(() => now), now);
    const runners = listRunners(db).map((r) => [r.name, r.online, r.assignmentBlocked]);
    expect(runners).toEqual([
      ["runner-a", true, false],
      ["runner-b", true, false],
      ["runner-c", false, false],
    ]);
    const blocked = listRunnerSnapshots(db, now).map((r) => r.blockedProjects);
    expect(blocked).toEqual([[], [RUNNER_PROJECTS.at(-1)?.id], []]);
  });

  it("러너마다 공급자 사용량: 정상, 90% 이상과 100%, 로그인 안 함·쓰지 않음", async () => {
    await seedDemo(db, box, new DemoWorld(() => now), now);
    const highest = listRunners(db).map((r) => {
      const reading = r.providerUsage?.reading;
      if (reading?.kind !== "read") return [r.name, null, []];
      const top = highestUsage(reading.providers);
      return [
        r.name,
        top === null ? null : top.window.usedPercent,
        [...new Set(reading.providers.map((p) => p.status))],
      ];
    });
    expect(highest).toEqual([
      ["runner-a", 72, ["ok", "signed-out", "unavailable"]],
      ["runner-b", 100, ["ok", "signed-out", "unavailable"]],
      ["runner-c", 54, ["ok"]],
    ]);
    const weekly = listRunners(db)[1]?.providerUsage?.reading;
    expect(
      weekly?.kind === "read" &&
        weekly.providers[0]?.windows.some((w) => w.kind === "weekly" && w.usedPercent >= 90),
    ).toBe(true);
  });

  it("가짜 세계를 DB 에서 되살리면 worker 한 바퀴 뒤에도 진행 중인 런이 그대로다", async () => {
    const world = new DemoWorld(() => now);
    await seedDemo(db, box, world, now);
    const before = listRuns(db)
      .filter((run) => run.state !== "ended" && run.state !== "queued")
      .map((run) => [run.ticket.key, run.state]);

    const fresh = new DemoWorld(() => now);
    hydrateWorld(db, fresh);
    const worker = createWorker({ dbPath, registry: fresh.registry(), secretBox: box });
    try {
      await worker.tick();
    } finally {
      await worker.close();
    }
    const after = listRuns(db)
      .filter((run) => before.some(([key]) => key === run.ticket.key) && run.state !== "ended")
      .map((run) => [run.ticket.key, run.state]);
    expect(after).toEqual(before);
  });
});
