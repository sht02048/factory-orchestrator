import { toDeliveryId, toLabelId, toTicketKey } from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  getRun,
  getRunWithRecords,
  listRuns,
  listUnprocessedTrackerEvents,
  recordTrackerEvent,
  saveAutoAssignLabel,
} from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, connection, projectA, trackerProject, workspaceId } from "./test-fixtures.js";

const failure = vi.hoisted(() => ({
  changeRunStateFailures: 0,
  recordStartRequestedFailures: 0,
  markTrackerEventProcessedFailures: 0,
}));

vi.mock("@ganger/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ganger/db")>();
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
    markTrackerEventProcessed: (...args: Parameters<typeof actual.markTrackerEventProcessed>) => {
      if (failure.markTrackerEventProcessedFailures > 0) {
        failure.markTrackerEventProcessedFailures -= 1;
        throw new Error("database is locked");
      }
      return actual.markTrackerEventProcessed(...args);
    },
  };
});

let h: Harness;

beforeEach(() => {
  h = new Harness();
  failure.changeRunStateFailures = 0;
  failure.recordStartRequestedFailures = 0;
  failure.markTrackerEventProcessedFailures = 0;
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

    await worker.tick();
    expect(getRun(h.db, run.id)).toMatchObject({ state: "ended", agentResult: "timed-out" });
    expect(stopAgent).toHaveBeenCalledTimes(1);
  });
});

describe("webhook 이벤트 처리 표시 쓰기 실패", () => {
  it("할당도 되돌려 런을 남기지 않고, 다음 바퀴에 같은 이벤트로 런을 하나만 만든다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const label = toLabelId("label-auto");
    saveAutoAssignLabel(h.db, { workspaceId, connection, labelId: label });
    recordTrackerEvent(h.db, connection, {
      deliveryId: toDeliveryId("delivery-1"),
      kind: "ticket.updated",
      ticketKey: toTicketKey("ENG-1"),
      projectId: trackerProject,
      labelIds: [label],
      previousLabelIds: [],
      receivedAt: h.now,
    });
    const worker = h.worker();

    failure.markTrackerEventProcessedFailures = 1;
    await worker.tick();
    expect(listRuns(h.db)).toEqual([]);
    expect(h.warnings.map((w) => w.message)).toContain("could not process tracker event");

    await worker.tick();
    await worker.tick();
    expect(listRuns(h.db)).toHaveLength(1);
    expect(listUnprocessedTrackerEvents(h.db)).toEqual([]);
  });
});
