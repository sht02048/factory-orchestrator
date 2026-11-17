import type { RetryToken } from "@factory/core";
import { getRun, getRunWithRecords } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, outcomeUnknownAfterStart, projectA } from "./test-fixtures.js";

const failure = vi.hoisted(() => ({ changeRunStateFailures: 0, updateRunRecordsFailures: 0 }));

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
    updateRunRecords: (...args: Parameters<typeof actual.updateRunRecords>) => {
      if (failure.updateRunRecordsFailures > 0) {
        failure.updateRunRecordsFailures -= 1;
        throw new Error("database is locked");
      }
      return actual.updateRunRecords(...args);
    },
  };
});

let h: Harness;

beforeEach(() => {
  h = new Harness();
  failure.changeRunStateFailures = 0;
  failure.updateRunRecordsFailures = 0;
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
    expect(h.runner(runnerA).worktrees.size).toBe(1);
  });

  it("기록 전에 러너가 Offline이 되어도 다른 러너에서 다시 시작하지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    const startRun = vi.spyOn(h.runner(runnerA), "startRun");

    failure.changeRunStateFailures = 1;
    await worker.tick();
    h.setRunnerOnline(runnerA, false);
    await worker.tick();
    expect(getRun(h.db, run.id)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(h.runner(runnerB).worktrees.size).toBe(0);

    h.setRunnerOnline(runnerA, true);
    await worker.tick();
    expect(getRun(h.db, run.id)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("다시 보내기 값을 DB에 쓰지 못해도 다음 바퀴에 그 값으로 다시 보낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const sent: Array<RetryToken | undefined> = [];

    h.wrapRunner = (fake) => outcomeUnknownAfterStart(fake, sent);
    const first = h.worker();
    failure.updateRunRecordsFailures = 1;
    await first.tick();
    expect(getRunWithRecords(h.db, run.id)?.records.retryToken).toBeNull();
    expect(h.runner(runnerA).worktrees.size).toBe(1);

    // 같은 데몬이 다음 바퀴에 메모리에 둔 값으로 다시 보낸다. 러너는 같은 시작을 돌려준다.
    await first.tick();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBeUndefined();
    expect(sent[1]).toBeDefined();
    expect(h.runner(runnerA).worktrees.size).toBe(1);
  });
});
