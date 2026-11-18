import {
  toDeliveryId,
  toLabelId,
  toTicketKey,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { LabelId, RunnerId, TrackerEvent, TrackerProjectId } from "@ganger/core";
import {
  listRuns,
  listUnprocessedTrackerEvents,
  recordTrackerEvent,
  requestRunCancel,
  saveAutoAssignLabel,
  saveMapping,
  saveWorkspaceTrackerProject,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_CORRECTION_FIRST_LOOKBACK_MS, POLL_CORRECTION_INTERVAL_MS } from "./auto-assign.js";
import {
  Harness,
  agent,
  connection,
  projectA,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const autoLabel = toLabelId("label-auto");
const otherLabel = toLabelId("label-other");
const unmappedProject = toTrackerProjectId("tp-unmapped");

let h: Harness;
let deliverySeq = 0;

let runnerA: RunnerId;

beforeEach(() => {
  h = new Harness();
  runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
  saveAutoAssignLabel(h.db, { workspaceId, connection, labelId: autoLabel });
});

afterEach(async () => {
  await h.cleanup();
});

function putTicket(
  key: string,
  labels: LabelId[],
  project: TrackerProjectId = trackerProject,
): void {
  h.tracker.addTicket({
    key: toTicketKey(key),
    title: `Ticket ${key}`,
    body: "Do the thing.",
    url: `https://tracker.example.com/${key}`,
    labels: labels.map((id) => ({ id, name: id })),
    project: { id: project, name: "Web" },
    state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
    updatedAt: h.now,
  });
}

function webhook(
  key: string,
  input: {
    kind?: TrackerEvent["kind"];
    labelIds: LabelId[];
    previousLabelIds: LabelId[] | null;
    project?: TrackerProjectId;
    deliveryId?: string;
  },
): TrackerEvent {
  const project = input.project ?? trackerProject;
  putTicket(key, input.labelIds, project);
  deliverySeq += 1;
  const event: TrackerEvent = {
    deliveryId: toDeliveryId(input.deliveryId ?? `delivery-${deliverySeq}`),
    kind: input.kind ?? "ticket.updated",
    ticketKey: toTicketKey(key),
    projectId: project,
    labelIds: input.labelIds,
    previousLabelIds: input.previousLabelIds,
    receivedAt: h.now,
  };
  recordTrackerEvent(h.db, connection, event);
  return event;
}

function runsOf(key: string): StoredRun[] {
  return listRuns(h.db, { ticket: { connection, key: toTicketKey(key) } });
}

describe("webhook 이벤트로 자동 할당", () => {
  it("Auto-assign Label이 방금 붙은 티켓에 Mapping의 프로젝트·에이전트로 런을 만들고 같은 바퀴에 시작한다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    const worker = h.worker();

    await worker.tick();

    const runs = runsOf("ENG-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "running", runnerProject: projectA, agent });
    expect(listUnprocessedTrackerEvents(h.db)).toEqual([]);
  });

  it("Mapping에 모델을 정했으면 런에 적고 러너 시작에 넘긴다(0043)", async () => {
    saveMapping(h.db, {
      connection,
      trackerProject,
      runnerProject: projectA,
      agent,
      model: "sonnet",
    });
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });

    await h.worker().tick();

    expect(runsOf("ENG-1")[0]).toMatchObject({ state: "running", model: "sonnet" });
    expect(h.runner(runnerA).startCalls.map((call) => call.model)).toEqual(["sonnet"]);
  });

  it("Mapping에 모델을 정하지 않았으면 러너 시작에 모델을 넘기지 않는다(0043)", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });

    await h.worker().tick();

    expect(runsOf("ENG-1")[0]).toMatchObject({ state: "running", model: null });
    const [call] = h.runner(runnerA).startCalls;
    expect(call).toBeDefined();
    expect(call !== undefined && "model" in call).toBe(false);
  });

  it("같은 webhook 이벤트가 두 번 와도 런이 하나만 생긴다", async () => {
    const event = webhook("ENG-1", {
      labelIds: [autoLabel],
      previousLabelIds: [],
      deliveryId: "same",
    });
    const worker = h.worker();
    await worker.tick();
    expect(recordTrackerEvent(h.db, connection, event)).toBe("duplicate");
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    await worker.tick();
    await worker.tick();
    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();

    expect(runsOf("ENG-1")).toHaveLength(1);
  });

  it("라벨을 단 채 만든 티켓은 방금 붙은 것으로 본다", async () => {
    webhook("ENG-1", { kind: "ticket.created", labelIds: [autoLabel], previousLabelIds: [] });

    await h.worker().tick();

    expect(runsOf("ENG-1")).toHaveLength(1);
  });

  it("라벨이 바뀌지 않은 이벤트나 다른 라벨이 붙은 이벤트로는 할당하지 않는다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: null });
    webhook("ENG-2", { labelIds: [autoLabel, otherLabel], previousLabelIds: [autoLabel] });
    webhook("ENG-3", { labelIds: [otherLabel], previousLabelIds: [] });
    webhook("ENG-4", { kind: "ticket.removed", labelIds: [autoLabel], previousLabelIds: [] });

    h.advance(POLL_CORRECTION_FIRST_LOOKBACK_MS * 2);
    await h.worker().tick();

    expect(listRuns(h.db)).toEqual([]);
    expect(listUnprocessedTrackerEvents(h.db)).toEqual([]);
  });

  it("쌓인 이벤트 중 뒤 이벤트에서 라벨을 뗐으면 앞의 붙임 이벤트로 할당하지 않는다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    h.advance(1000);
    webhook("ENG-1", { labelIds: [], previousLabelIds: [autoLabel] });

    await h.worker().tick();

    expect(runsOf("ENG-1")).toEqual([]);
    expect(listUnprocessedTrackerEvents(h.db)).toEqual([]);
  });

  it("쌓인 이벤트 중 뒤 이벤트가 티켓 보관·삭제면 앞의 붙임 이벤트로 할당하지 않는다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    h.advance(1000);
    webhook("ENG-1", { kind: "ticket.removed", labelIds: [autoLabel], previousLabelIds: null });
    h.tracker.tickets.delete(toTicketKey("ENG-1"));

    await h.worker().tick();

    expect(runsOf("ENG-1")).toEqual([]);
  });

  it("라벨이 붙었지만 Mapping이 없는 트래커 프로젝트의 티켓에는 런이 생기지 않는다", async () => {
    saveWorkspaceTrackerProject(h.db, {
      workspaceId,
      connection,
      projectId: unmappedProject,
      name: "Unmapped",
      inProgressStateId: null,
    });
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [], project: unmappedProject });
    webhook("ENG-2", {
      labelIds: [autoLabel],
      previousLabelIds: [],
      project: toTrackerProjectId("tp-elsewhere"),
    });
    const worker = h.worker();

    await worker.tick();
    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();

    expect(listRuns(h.db)).toEqual([]);
    expect(listUnprocessedTrackerEvents(h.db)).toEqual([]);
  });

  it("끝나지 않은 런이 있는 티켓에는 라벨을 다시 붙여도 새 런을 만들지 않는다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    const worker = h.worker();
    await worker.tick();

    webhook("ENG-1", { labelIds: [], previousLabelIds: [autoLabel] });
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    await worker.tick();

    expect(runsOf("ENG-1")).toHaveLength(1);
  });
});

describe("폴링 보정", () => {
  it("webhook을 놓쳐도 폴링 보정으로 런이 생긴다", async () => {
    const worker = h.worker();
    const list = vi.spyOn(h.tracker, "listLabeledTickets");
    await worker.tick();
    expect(list).toHaveBeenCalledTimes(1);

    h.advance(1000);
    putTicket("ENG-1", [autoLabel]);
    await worker.tick();
    expect(list).toHaveBeenCalledTimes(1);
    expect(runsOf("ENG-1")).toEqual([]);

    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();
    expect(list).toHaveBeenCalledTimes(2);
    const runs = runsOf("ENG-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "running", runnerProject: projectA, agent });
  });

  it("데몬을 띄운 뒤 첫 보정은 그 전에 붙은 라벨을 맞추고, 런이 끝난 티켓은 다시 할당하지 않는다", async () => {
    putTicket("ENG-1", [autoLabel]);
    h.advance(60 * 60_000);
    const worker = h.worker();
    await worker.tick();
    const [run] = runsOf("ENG-1");
    expect(run?.state).toBe("running");
    if (run === undefined || run.state !== "running") throw new Error("run did not start");

    h.runner(run.runnerId).report(run.worktree, { outcome: "succeeded", body: "done" });
    await worker.tick();
    putTicket("ENG-1", [autoLabel]);
    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();

    const runs = runsOf("ENG-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("ended");
  });

  it("Mapping이 없는 트래커 프로젝트의 티켓과 다른 라벨만 붙은 티켓은 할당하지 않는다", async () => {
    saveWorkspaceTrackerProject(h.db, {
      workspaceId,
      connection,
      projectId: unmappedProject,
      name: "Unmapped",
      inProgressStateId: null,
    });
    putTicket("ENG-1", [autoLabel], unmappedProject);
    putTicket("ENG-2", [otherLabel]);

    await h.worker().tick();

    expect(listRuns(h.db)).toEqual([]);
  });

  it("조회에 실패하면 같은 기간을 다음 보정에 다시 본다", async () => {
    const worker = h.worker();
    const list = vi
      .spyOn(h.tracker, "listLabeledTickets")
      .mockRejectedValueOnce(new Error("rate limited"));
    putTicket("ENG-1", [autoLabel]);
    await worker.tick();
    expect(runsOf("ENG-1")).toEqual([]);
    expect(h.warnings.map((w) => w.message)).toContain("could not list labeled tickets");

    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();
    expect(list).toHaveBeenCalledTimes(2);
    const since = list.mock.calls[1]?.[0].updatedSince;
    expect(since?.getTime()).toBeLessThanOrEqual(
      h.now.getTime() - POLL_CORRECTION_FIRST_LOOKBACK_MS,
    );
    expect(runsOf("ENG-1")).toHaveLength(1);
  });
});

describe("운영자가 취소한 티켓(Q82.12)", () => {
  it("런을 취소한 티켓은 폴링 보정이 다시 할당하지 않고, 라벨을 떼었다 다시 붙이면 새 런이 생긴다", async () => {
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    const worker = h.worker();
    await worker.tick();
    const [first] = runsOf("ENG-1");
    if (first === undefined) throw new Error("no run");

    h.advance(1000);
    expect(requestRunCancel(h.db, first.id, h.now).ok).toBe(true);
    await worker.tick();
    expect(runsOf("ENG-1")[0]).toMatchObject({ state: "ended", agentResult: "canceled" });

    h.advance(1000);
    putTicket("ENG-1", [autoLabel]);
    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: null });
    await worker.tick();
    expect(runsOf("ENG-1")).toHaveLength(1);

    h.advance(1000);
    webhook("ENG-1", { labelIds: [], previousLabelIds: [autoLabel] });
    h.advance(1000);
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    await worker.tick();

    const runs = runsOf("ENG-1");
    expect(runs).toHaveLength(2);
    expect(runs[1]?.state).toBe("running");
  });
});
