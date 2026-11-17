import { DEFAULT_MAX_RUN_MS, getRun, getRunWithRecords } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA } from "./test-fixtures.js";

const failure = vi.hoisted(() => ({ changeRunStateFailures: 0, recordStartRequestedFailures: 0 }));

// 정한 횟수만큼 DB 쓰기를 실패하게 한다(쓰기 잠금 시간 초과 같은 경우).
vi.mock("@factory/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@factory/db")>();
  return {
    ...actual,
    changeRunState: (...args: Parameters<typeof actual.changeRunState>) => {
      if (failure.changeRunStateFailures > 0) {
        failure.changeRunStateFailures -= 1;
        throw new Error("database is locked");
      }
      return actual.changeRunState(...args);
    },
    recordStartRequested: (...args: Parameters<typeof actual.recordStartRequested>) => {
      if (failure.recordStartRequestedFailures > 0) {
        failure.recordStartRequestedFailures -= 1;
        throw new Error("database is locked");
      }
      return actual.recordStartRequested(...args);
    },
  };
});

let h: Harness;

beforeEach(() => {
  h = new Harness();
  failure.changeRunStateFailures = 0;
  failure.recordStartRequestedFailures = 0;
});

afterEach(async () => {
  await h.cleanup();
});

describe("러너에서 시작한 뒤 DB 쓰기 실패", () => {
  it("다음 바퀴에 러너에 다시 보내지 않고 Running만 다시 쓴다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    const startRun = vi.spyOn(h.runner(runnerA), "startRun");

    failure.changeRunStateFailures = 1;
    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("queued");
    expect(h.warnings.map((w) => w.message)).toContain("could not write run");

    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("running");
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(h.runner(runnerA).runs.size).toBe(1);
  });

  it("기록 전에 러너가 Offline이 되어도 다른 러너에서 다시 시작하지 않고 시작한 러너로 기록한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    const startRun = vi.spyOn(h.runner(runnerA), "startRun");

    failure.changeRunStateFailures = 1;
    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("queued");

    h.setRunnerOnline(runnerA, false);
    await worker.tick();
    expect(getRun(h.db, run.id)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(h.runner(runnerB).runs.size).toBe(0);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("기록하지 못한 시작은 그 러너의 capacity를 차지한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const worker = h.worker();

    // 첫 런의 Running 쓰기가 두 번(시작 직후, 다음 바퀴 첫 기록) 실패한다.
    failure.changeRunStateFailures = 2;
    await worker.tick();
    await worker.tick();
    expect(getRun(h.db, first.id)?.state).toBe("queued");
    expect(getRun(h.db, second.id)?.state).toBe("queued");
    expect(h.runner(runnerA).runs.size).toBe(1);

    await worker.tick();
    expect(getRun(h.db, first.id)?.state).toBe("running");
    expect(getRun(h.db, second.id)?.state).toBe("queued");
  });

  it("시작 요청 시각을 DB에 쓰지 못하면 러너에 보내지 않고 다음 바퀴에 다시 해 본다(시작 멱등)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();

    failure.recordStartRequestedFailures = 1;
    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("queued");
    expect(h.runner(runnerA).startCalls).toHaveLength(0);

    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("running");
    expect(getRunWithRecords(h.db, run.id)?.records.startRequestedAt).not.toBeNull();
    expect(h.runner(runnerA).startCalls).toHaveLength(1);
  });
});

describe("에이전트를 멈춘 뒤 DB 쓰기 실패", () => {
  it("다음 바퀴에 실제 상태로 다시 정하지 않고 멈출 때 정한 에이전트 결과로 기록한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const stopAgent = vi.spyOn(h.runner(runnerA), "stopAgent");

    h.advance(DEFAULT_MAX_RUN_MS);
    failure.changeRunStateFailures = 1;
    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("running");
    expect(stopAgent).toHaveBeenCalledTimes(1);

    // 멈춘 에이전트는 러너에서 보고 없이 사라진 것으로 보인다.
    await worker.tick();
    expect(getRun(h.db, run.id)).toMatchObject({ state: "ended", agentResult: "timed-out" });
    expect(stopAgent).toHaveBeenCalledTimes(1);
  });
});
