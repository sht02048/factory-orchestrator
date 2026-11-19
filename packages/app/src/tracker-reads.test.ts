import {
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { Page, Paged, TrackerProjectId, TrackerTicket } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  markTrackerChanged,
  migrate,
  openDatabase,
  saveTrackerConnection,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import { TRACKER_READ_FRESH_MS, TRACKER_READ_MAX_AGE_MS, TrackerReads } from "./tracker-reads.js";

const connection = toTrackerConnectionId("conn-acme");
const project = toTrackerProjectId("tp-web");

class CountingTracker extends FakeTracker {
  ticketReads = 0;
  release: (() => void) | null = null;

  override async listProjectTickets(
    projectId: TrackerProjectId,
    page?: Page,
  ): Promise<Paged<TrackerTicket>> {
    this.ticketReads += 1;
    if (this.release === null) return super.listProjectTickets(projectId, page);
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return super.listProjectTickets(projectId, page);
  }
}

function setState(tracker: FakeTracker, state: string): void {
  tracker.addTicket({
    key: toTicketKey("ACME-1"),
    title: "ACME-1",
    body: "",
    url: "https://tracker.example.com/ACME-1",
    labels: [],
    project: { id: project, name: "Web" },
    state: { id: toTrackerStateId(`st-${state}`), name: state, category: "unstarted" },
    updatedAt: new Date(0),
  });
}

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  saveTrackerConnection(
    db,
    new SecretBox(new Uint8Array(32).fill(7)),
    { id: connection, kind: toTrackerKind("fake"), name: "Acme", config: {}, secrets: {} },
    new Date(0),
  );
  const tracker = new CountingTracker();
  setState(tracker, "Todo");
  let clock = 0;
  const reads = new TrackerReads({ now: () => clock });
  const cached = reads.wrap(db, connection, tracker);
  const stateName = async () =>
    (await cached.listProjectTickets(project)).items[0]?.state.name ?? null;
  return {
    db,
    tracker,
    stateName,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("트래커 읽기 담아 두기(0122)", () => {
  it("새것인 동안은 트래커를 다시 부르지 않는다", async () => {
    const { tracker, stateName, advance } = setup();
    expect(await stateName()).toBe("Todo");
    setState(tracker, "Done");
    advance(TRACKER_READ_FRESH_MS - 1);

    expect(await stateName()).toBe("Todo");
    expect(tracker.ticketReads).toBe(1);
  });

  it("새것 시간이 지나면 담아 둔 값을 바로 주고 뒤에서 새로 읽어, 다음 읽기에 새 값을 준다", async () => {
    const { tracker, stateName, advance } = setup();
    await stateName();
    setState(tracker, "Done");
    advance(TRACKER_READ_FRESH_MS);

    expect(await stateName()).toBe("Todo");
    await settle();
    expect(tracker.ticketReads).toBe(2);
    expect(await stateName()).toBe("Done");
  });

  it(`담은 지 ${TRACKER_READ_MAX_AGE_MS / 60_000}분이 지난 값은 주지 않고 트래커를 기다린다`, async () => {
    const { tracker, stateName, advance } = setup();
    await stateName();
    setState(tracker, "Done");
    advance(TRACKER_READ_MAX_AGE_MS);

    expect(await stateName()).toBe("Done");
  });

  it("연결이 바뀌었다고 표시되면(webhook·할당·라벨 만들기·다시 읽기) 새것이어도 트래커를 기다린다", async () => {
    const { db, tracker, stateName } = setup();
    await stateName();
    setState(tracker, "Done");
    markTrackerChanged(db, connection);

    expect(await stateName()).toBe("Done");
    expect(tracker.ticketReads).toBe(2);
  });

  it("읽는 동안 바뀌었다고 표시되면 그 결과를 다음 읽기에 쓰지 않는다", async () => {
    const { db, tracker, stateName } = setup();
    tracker.release = () => undefined;
    const reading = stateName();
    await settle();
    setState(tracker, "Done");
    markTrackerChanged(db, connection);
    tracker.release();
    await reading;

    tracker.release = null;
    expect(await stateName()).toBe("Done");
    expect(tracker.ticketReads).toBe(2);
  });

  it("같은 읽기가 겹치면 트래커를 한 번만 부르고, 실패는 담아 두지 않는다", async () => {
    const { tracker, stateName } = setup();
    const both = Promise.all([stateName(), stateName()]);
    expect(await both).toEqual(["Todo", "Todo"]);
    expect(tracker.ticketReads).toBe(1);

    const failing = setup();
    let fail = true;
    const original = failing.tracker.listStates.bind(failing.tracker);
    failing.tracker.listStates = (projectId) =>
      fail ? Promise.reject(new Error("network")) : original(projectId);
    const reads = new TrackerReads();
    const cached = reads.wrap(failing.db, connection, failing.tracker);
    await expect(cached.listStates(project)).rejects.toThrow("network");
    fail = false;
    await expect(cached.listStates(project)).resolves.toEqual([]);
  });
});
