import { getRun } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA } from "./test-fixtures.js";

const failure = vi.hoisted(() => ({ changeRunStateFailures: 0 }));

// Running을 쓰는 DB 쓰기만 실패하게 한다(쓰기 잠금 시간 초과 같은 경우).
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
  };
});

let h: Harness;

beforeEach(() => {
  h = new Harness();
  failure.changeRunStateFailures = 0;
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
});
