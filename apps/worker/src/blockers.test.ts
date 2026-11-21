import { AdapterError, toDeliveryId, toTicketKey, toTrackerStateId } from "@ganger/core";
import type { TicketBlocker, TicketPriority } from "@ganger/core";
import {
  continueRun,
  getRun,
  getRunBlockerState,
  recordTrackerEvent,
  requestRunCancel,
  skipBlockerWait,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKER_POLL_INTERVAL_MS } from "./blockers.js";
import { Harness, connection, projectA, trackerProject } from "./test-fixtures.js";

const REQUEST_ID = "request-0159-0001";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

function stateOf(run: StoredRun): string | undefined {
  return getRun(h.db, run.id)?.state;
}

function blocker(key: string, category = "started"): TicketBlocker {
  return {
    key: toTicketKey(key),
    title: `Ticket ${key}`,
    state: { id: toTrackerStateId(category), name: category, category },
  };
}

function relate(key: string, blockers: TicketBlocker[], priority: TicketPriority = "none"): void {
  h.tracker.relations.set(toTicketKey(key), { priority, blockers });
}

function afterPoll(): void {
  h.advance(BLOCKER_POLL_INTERVAL_MS + 1);
}

describe("선행 티켓을 기다리는 런", () => {
  it("러너 자리를 차지하지 않아 뒤 런이 먼저 시작하고, 자리가 없는 동안 상태만 새로 읽는다(B3)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const waiting = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1")]);
    const free = h.assign("ENG-2", projectA);
    const worker = h.worker();

    await worker.tick();
    expect([stateOf(waiting), stateOf(free)]).toEqual(["queued", "running"]);

    relate("ENG-1", [blocker("OPS-1", "completed")]);
    afterPoll();
    await worker.tick();
    expect(stateOf(waiting)).toBe("queued");
    expect(getRunBlockerState(h.db, waiting.id)?.blockers[0]?.stateCategory).toBe("completed");
  });

  it("빈 러너가 있으면 선행 티켓이 끝난 다음 폴링에서 시작한다(B9)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1")]);
    const worker = h.worker();

    await worker.tick();
    expect(stateOf(run)).toBe("queued");

    relate("ENG-1", [blocker("OPS-1", "completed")]);
    await worker.tick();
    expect(stateOf(run)).toBe("queued");

    afterPoll();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("선행 티켓의 webhook을 받으면 폴링을 기다리지 않고 반영한다(B9)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1")]);
    const worker = h.worker();
    await worker.tick();

    relate("ENG-1", [blocker("OPS-1", "completed")]);
    recordTrackerEvent(h.db, connection, {
      deliveryId: toDeliveryId("delivery-1"),
      kind: "ticket.updated",
      ticketKey: toTicketKey("OPS-1"),
      projectId: trackerProject,
      labelIds: [],
      previousLabelIds: null,
      receivedAt: h.now,
    });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("Queued 중 관계를 지우면 시작하고, 시작한 런은 새 관계를 무시한다(B10)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1")]);
    const worker = h.worker();
    await worker.tick();

    relate("ENG-1", []);
    afterPoll();
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    relate("ENG-1", [blocker("OPS-2")]);
    afterPoll();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("시작 직전에 다시 읽어 그사이 생긴 관계나 다시 열린 선행 티켓을 기다린다(B10)", async () => {
    const runner = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const worker = h.worker();
    await worker.tick();
    expect([stateOf(first), stateOf(second)]).toEqual(["running", "queued"]);

    relate("ENG-2", [blocker("OPS-1")]);
    afterPoll();
    const started = getRun(h.db, first.id);
    if (started === null || started.state === "queued" || started.worktree === null) {
      throw new Error("first run has not started");
    }
    h.runner(runner).report(started.worktree, { outcome: "succeeded", body: "done" });
    await worker.tick();

    expect(stateOf(second)).toBe("queued");
    expect(getRunBlockerState(h.db, second.id)?.blockers.map((b) => b.key)).toEqual(["OPS-1"]);
  });

  it("취소된 선행 티켓은 멈춘 기다림으로 남는다(B2)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1", "canceled")]);
    await h.worker().tick();
    expect(stateOf(run)).toBe("queued");
  });

  it("읽지 못하면 시작하지 않고, 다시 읽히면 시작한다(B7)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    h.tracker.relationsError = new AdapterError({ kind: "network", cause: null });
    const worker = h.worker();
    await worker.tick();
    expect(stateOf(run)).toBe("queued");
    expect(getRunBlockerState(h.db, run.id)?.readFailed).toBe(true);

    h.tracker.relationsError = null;
    afterPoll();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("트래커가 응답하지 않으면 한 tick에 그 연결을 한 번만 읽고 나머지는 다음 폴링으로 미룬다", async () => {
    h.addRunner({ id: "runner-a", capacity: 3, projects: [projectA] });
    const runs = [
      h.assign("ENG-1", projectA),
      h.assign("ENG-2", projectA),
      h.assign("ENG-3", projectA),
    ];
    h.tracker.relationsError = new AdapterError({ kind: "network", cause: null });
    const reads = vi.spyOn(h.tracker, "getTicketRelations");

    await h.worker().tick();

    expect(reads).toHaveBeenCalledTimes(1);
    for (const run of runs) {
      expect(stateOf(run)).toBe("queued");
      expect(getRunBlockerState(h.db, run.id)?.readFailed).toBe(true);
    }
  });

  it("티켓 하나만 읽지 못하면 그 런만 멈추고 같은 연결의 다른 런은 시작한다(B7·B9)", async () => {
    h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const broken = h.assign("ENG-1", projectA);
    const other = h.assign("ENG-2", projectA);
    relate("ENG-2", [blocker("OPS-1")]);
    const read = h.tracker.getTicketRelations.bind(h.tracker);
    vi.spyOn(h.tracker, "getTicketRelations").mockImplementation((key) =>
      key === toTicketKey("ENG-1") ? Promise.reject(new Error("bad response")) : read(key),
    );
    const worker = h.worker();
    await worker.tick();
    expect(stateOf(other)).toBe("queued");

    relate("ENG-2", [blocker("OPS-1", "completed")]);
    afterPoll();
    await worker.tick();

    expect(stateOf(broken)).toBe("queued");
    expect(getRunBlockerState(h.db, broken.id)?.readFailed).toBe(true);
    expect(stateOf(other)).toBe("running");
  });

  it("관계 읽기가 없다고 해도 티켓이 있으면 선행 티켓 없이 시작하지 않는다(B7)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    vi.spyOn(h.tracker, "getTicketRelations").mockResolvedValue(null);

    await h.worker().tick();

    expect(stateOf(run)).toBe("queued");
    expect(getRunBlockerState(h.db, run.id)?.readFailed).toBe(true);
  });

  it("지워진 티켓의 런은 기다리지 않고 시작할 수 없음으로 끝난다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    h.tracker.tickets.delete(toTicketKey("ENG-1"));

    await h.worker().tick();

    expect(getRun(h.db, run.id)).toMatchObject({
      state: "ended",
      agentResult: "could-not-start",
    });
  });

  it("지워진 티켓을 이어서 맡긴 런은 선행 티켓을 건너뛰고 시작하지 않는다", async () => {
    const runner = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const started = getRun(h.db, source.id);
    if (started === null || started.state === "queued" || started.worktree === null) {
      throw new Error("source run has not started");
    }
    h.runner(runner).report(started.worktree, { outcome: "succeeded", body: "done" });
    await worker.tick();
    const continued = continueRun(h.db, {
      from: source.id,
      message: "keep going",
      now: h.now,
    });
    if (!continued.ok) throw new Error(`continue failed: ${continued.reason}`);
    h.tracker.tickets.delete(toTicketKey("ENG-1"));

    await worker.tick();

    expect(getRun(h.db, continued.run.id)?.state).toBe("queued");
    expect(getRunBlockerState(h.db, continued.run.id)?.readFailed).toBe(true);
  });

  it("서로 기다리는 런은 저절로 풀지 않는다(B8)", async () => {
    h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const one = h.assign("ENG-1", projectA);
    const two = h.assign("ENG-2", projectA);
    relate("ENG-1", [blocker("ENG-2")]);
    relate("ENG-2", [blocker("ENG-1")]);
    await h.worker().tick();

    expect([stateOf(one), stateOf(two)]).toEqual(["queued", "queued"]);
    expect(getRunBlockerState(h.db, one.id)?.blockers[0]?.inCycle).toBe(true);
  });

  it("같은 러너 줄에서 우선순위가 높은 런이 먼저 시작한다(B6)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const low = h.assign("ENG-1", projectA);
    const urgent = h.assign("ENG-2", projectA);
    relate("ENG-1", [], "low");
    relate("ENG-2", [], "urgent");
    await h.worker().tick();
    expect([stateOf(low), stateOf(urgent)]).toEqual(["queued", "running"]);
  });

  it("고정된 러너가 꽉 차면 우선순위가 높아도 그 러너를 기다리고 다른 런은 빈 러너로 간다(0155)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const holder = h.assign("ENG-1", projectA, runnerA);
    relate("ENG-1", [], "urgent");
    const pinned = h.assign("ENG-2", projectA, runnerA);
    relate("ENG-2", [], "high");
    const free = h.assign("ENG-3", projectA);
    relate("ENG-3", [], "low");
    await h.worker().tick();

    expect([stateOf(holder), stateOf(pinned), stateOf(free)]).toEqual([
      "running",
      "queued",
      "running",
    ]);
    expect(getRun(h.db, pinned.id)?.runnerId).toBe(runnerA);
  });
});

describe("기다리지 않고 시작", () => {
  it("기다리는 런을 보통 줄에 세우고, 선행 티켓이 그대로여도 시작한다(B5)", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1", "canceled")]);
    const worker = h.worker();
    await worker.tick();
    expect(stateOf(run)).toBe("queued");

    expect(skipBlockerWait(h.db, run.id, REQUEST_ID, h.now)).toEqual({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("같은 요청 ID를 다시 보내면 런이 시작한 뒤에도 같은 결과를 돌려준다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    relate("ENG-1", [blocker("OPS-1")]);
    const worker = h.worker();
    await worker.tick();

    skipBlockerWait(h.db, run.id, REQUEST_ID, h.now);
    h.advance(1000);
    expect(skipBlockerWait(h.db, run.id, REQUEST_ID, h.now)).toEqual({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(skipBlockerWait(h.db, run.id, REQUEST_ID, h.now)).toEqual({ ok: true });
    expect(skipBlockerWait(h.db, run.id, "request-0159-0002", h.now)).toEqual({
      ok: false,
      reason: "not-queued",
    });
  });

  it("기다리지 않는 런과 취소 중인 런은 거절한다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.assign("ENG-0", projectA);
    const free = h.assign("ENG-1", projectA);
    const canceling = h.assign("ENG-2", projectA);
    relate("ENG-2", [blocker("OPS-1")]);
    await h.worker().tick();

    expect(skipBlockerWait(h.db, free.id, REQUEST_ID, h.now)).toEqual({
      ok: false,
      reason: "not-waiting",
    });
    requestRunCancel(h.db, canceling.id, h.now);
    expect(skipBlockerWait(h.db, canceling.id, REQUEST_ID, h.now)).toEqual({
      ok: false,
      reason: "cancelling",
    });
  });
});
