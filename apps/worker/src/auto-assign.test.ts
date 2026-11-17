import {
  toDeliveryId,
  toLabelId,
  toTicketKey,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type { LabelId, TrackerEvent, TrackerProjectId } from "@factory/core";
import {
  listRuns,
  listUnprocessedTrackerEvents,
  recordTrackerEvent,
  requestRunCancel,
  saveAutoAssignLabel,
  saveWorkspaceTrackerProject,
} from "@factory/db";
import type { StoredRun } from "@factory/db";
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

beforeEach(() => {
  h = new Harness();
  h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
  saveAutoAssignLabel(h.db, { workspaceId, connection, labelId: autoLabel });
});

afterEach(async () => {
  await h.cleanup();
});

/** 트래커에 티켓을 넣거나 라벨을 바꾼다. 갱신 시각은 지금이다. */
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

/** web이 webhook을 검증해 DB에 쓴 것처럼 이벤트를 기록한다. 트래커의 티켓도 이벤트 뒤 모습으로 맞춘다. */
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

  it("같은 webhook 이벤트가 두 번 와도 런이 하나만 생긴다", async () => {
    const event = webhook("ENG-1", {
      labelIds: [autoLabel],
      previousLabelIds: [],
      deliveryId: "same",
    });
    const worker = h.worker();
    await worker.tick();
    // 같은 Linear-Delivery가 다시 온다. web은 다시 쓰지 않는다.
    expect(recordTrackerEvent(h.db, connection, event)).toBe("duplicate");
    // 같은 변경이 다른 중복 제거 키로 다시 와도 끝나지 않은 런이 있으면 만들지 않는다.
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [] });
    await worker.tick();
    // 처리한 이벤트는 런이 끝난 뒤에도 다시 보지 않는다.
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
    // 제목만 바뀜: 라벨은 남아 있지만 이 이벤트로 붙은 것이 아니다.
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: null });
    webhook("ENG-2", { labelIds: [autoLabel, otherLabel], previousLabelIds: [autoLabel] });
    webhook("ENG-3", { labelIds: [otherLabel], previousLabelIds: [] });
    webhook("ENG-4", { kind: "ticket.removed", labelIds: [autoLabel], previousLabelIds: [] });

    // 폴링 보정이 라벨이 남은 티켓을 할당하지 않게 첫 보정 기간 밖으로 시간을 옮긴다.
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

  it("라벨이 붙었지만 Mapping이 없는 트래커 프로젝트의 티켓에는 런이 생기지 않는다", async () => {
    saveWorkspaceTrackerProject(h.db, {
      workspaceId,
      connection,
      projectId: unmappedProject,
      name: "Unmapped",
      inProgressStateId: null,
    });
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: [], project: unmappedProject });
    // Workspace에 묶이지 않은 트래커 프로젝트도 할당하지 않는다.
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

    // 라벨이 붙었지만 webhook이 오지 않았다.
    h.advance(1000);
    putTicket("ENG-1", [autoLabel]);
    await worker.tick();
    // 보정 간격이 지나기 전에는 조회하지 않는다.
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

    // 런이 끝나고 결과 댓글 등으로 티켓이 갱신돼도 라벨이 남았을 뿐이라 다시 할당하지 않는다.
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
    // 실패한 보정이 기간을 넘기지 않아 첫 보정 기간부터 다시 본다.
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

    // 라벨은 남아 있고 티켓이 갱신됐다. 폴링 보정은 다시 할당하지 않는다.
    h.advance(1000);
    putTicket("ENG-1", [autoLabel]);
    h.advance(POLL_CORRECTION_INTERVAL_MS);
    await worker.tick();
    // 라벨과 상관없는 갱신 이벤트도 할당하지 않는다.
    webhook("ENG-1", { labelIds: [autoLabel], previousLabelIds: null });
    await worker.tick();
    expect(runsOf("ENG-1")).toHaveLength(1);

    // 떼었다 다시 붙인다.
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
