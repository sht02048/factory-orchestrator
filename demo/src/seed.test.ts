import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeRunOutcome } from "@factory/core";
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
  listRunners,
  listRuns,
  migrate,
  openDatabase,
} from "@factory/db";
import type { Database } from "@factory/db";
import { createWorker } from "@factory/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hydrateWorld } from "./hydrate.js";
import { HISTORY_DAYS, seedDemo } from "./seed.js";
import { DemoWorld } from "./world.js";

/*
 * 미리 채운 모드의 시드(티켓 0047). 온보딩을 마친 설치로 보이고, 런의 모든 상태와 요약 결과 넷이 있고,
 * 통계에 쓸 지난 2주 런이 있다. 시드를 쓴 DB 에서 worker 가 한 바퀴 돌아도 진행 중인 런이 그대로인지도 본다
 * (가짜 러너를 DB 에서 되살리지 못하면 worker 가 워크트리 없음으로 끝낸다).
 */

// worker 는 실제 시계로 최대 실행 시간을 보므로 시드도 지금을 기준으로 한다.
const now = new Date();
const box = new SecretBox(new Uint8Array(32).fill(5));

let dir: string;
let dbPath: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-dev-seed-"));
  dbPath = join(dir, "factory.db");
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
    // 온보딩 5단계의 조건(apps/web/src/onboarding/load.ts): 트래커 연결, GitHub 토큰, 러너, Workspace,
    // "In Progress" 상태·Auto-assign Label 까지 정한 Mapping. 홈이 온보딩으로 보내지 않는 것은 dev.test.ts 가 본다.
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

  it("런의 모든 상태와 요약 결과 넷, 질문·권한 대기를 만든다", async () => {
    const seeded = await seedDemo(db, box, new DemoWorld(() => now), now);
    const runs = listRuns(db);
    expect(new Set(runs.map((run) => run.state))).toEqual(
      new Set(["queued", "running", "waiting-for-input", "disconnected", "ended"]),
    );
    const outcomes = new Set(
      runs.flatMap((run) => (run.state === "ended" ? [summarizeRunOutcome(run).outcome] : [])),
    );
    expect(outcomes).toEqual(new Set(["merged", "human-check", "failed", "canceled"]));
    expect(listRunQuestions(db, seeded.question).filter((q) => q.answer === null)).toHaveLength(1);
    expect(listRunPermissionWaits(db, seeded.permission)).toHaveLength(1);
    // 지난 런은 진행 중인 런의 티켓을 쓰지 않는다. 쓰면 지난 PR 이 진행 중인 런의 PR 로 잡힌다.
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

  it("러너 셋: Online, GitHub 인증 깨짐, Offline", async () => {
    await seedDemo(db, box, new DemoWorld(() => now), now);
    const runners = listRunners(db).map((r) => [r.name, r.online, r.assignmentBlocked]);
    expect(runners).toEqual([
      ["runner-a", true, false],
      ["runner-b", true, true],
      ["runner-c", false, false],
    ]);
  });

  it("가짜 세계를 DB 에서 되살리면 worker 한 바퀴 뒤에도 진행 중인 런이 그대로다", async () => {
    const world = new DemoWorld(() => now);
    await seedDemo(db, box, world, now);
    const before = listRuns(db)
      .filter((run) => run.state !== "ended" && run.state !== "queued")
      .map((run) => [run.ticket.key, run.state]);

    // 다시 띄운 것처럼 새 세계를 DB 에서 만든다
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
