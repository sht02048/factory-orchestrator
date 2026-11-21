import { describe, expect, it } from "vitest";
import { decideBlockerWait, findBlockersInCycle } from "./blockers.js";
import type { BlockerWaitInput, StoredBlocker, TicketBlocker } from "./blockers.js";
import { toAgentId, toRunId, toRunnerProjectId, toTicketKey, toTrackerStateId } from "./ids.js";
import type { TicketKey } from "./ids.js";
import { queueOrder } from "./queue.js";

function stored(key: string, stateCategory: string, inCycle = false): StoredBlocker {
  return { key: toTicketKey(key), title: key, stateName: stateCategory, stateCategory, inCycle };
}

function input(overrides: Partial<BlockerWaitInput>): BlockerWaitInput {
  return {
    readAt: new Date("2026-11-21T00:00:00Z"),
    readFailed: false,
    skipped: false,
    startRequested: false,
    blockers: [],
    ...overrides,
  };
}

function live(key: string, category = "started"): TicketBlocker {
  return {
    key: toTicketKey(key),
    title: key,
    state: { id: toTrackerStateId(category), name: category, category },
  };
}

describe("선행 티켓 기다림 판단", () => {
  it("모든 선행 티켓이 completed면 기다리지 않는다(B1)", () => {
    expect(decideBlockerWait(input({ blockers: [stored("A-1", "completed")] })).kind).toBe("none");
  });

  it("끝나지 않은 선행 티켓만 기다린다(B3)", () => {
    const wait = decideBlockerWait(
      input({ blockers: [stored("A-1", "completed"), stored("A-2", "started")] }),
    );
    expect(wait).toMatchObject({ kind: "waiting", blockers: [{ key: "A-2" }] });
  });

  it("취소된 선행 티켓은 끝난 것이 아니라 멈춘 기다림이다(B2)", () => {
    expect(decideBlockerWait(input({ blockers: [stored("A-1", "canceled")] }))).toMatchObject({
      kind: "stuck",
      cause: "canceled",
      blocker: { key: "A-1" },
    });
  });

  it("읽지 못하면 이전에 끝났던 선행 티켓도 끝난 것으로 보지 않는다(B7)", () => {
    expect(
      decideBlockerWait(input({ readFailed: true, blockers: [stored("A-1", "completed")] })),
    ).toMatchObject({ kind: "stuck", cause: "unreadable", blocker: { key: "A-1" } });
  });

  it("서로 기다리면 멈춘 기다림이다(B8)", () => {
    expect(decideBlockerWait(input({ blockers: [stored("A-1", "started", true)] }))).toMatchObject({
      kind: "stuck",
      cause: "cycle",
    });
  });

  it("아직 읽지 않은 런은 확인 중이고, 기다리지 않고 시작한 런과 시작을 보낸 런은 기다리지 않는다(B5·B10)", () => {
    expect(decideBlockerWait(input({ readAt: null })).kind).toBe("checking");
    const open = [stored("A-1", "started")];
    expect(decideBlockerWait(input({ skipped: true, blockers: open })).kind).toBe("none");
    expect(decideBlockerWait(input({ startRequested: true, blockers: open })).kind).toBe("none");
  });
});

describe("순환 찾기", () => {
  const graph = (edges: Record<string, TicketBlocker[]>) => (key: TicketKey) =>
    Promise.resolve(edges[key] ?? []);

  it("여러 단계를 돌아 자기에게 오는 선행 티켓을 찾는다", async () => {
    const found = await findBlockersInCycle({
      ticket: toTicketKey("A-1"),
      blockers: [live("A-2"), live("A-9")],
      read: graph({ "A-2": [live("A-3")], "A-3": [live("A-1")] }),
    });
    expect([...found]).toEqual(["A-2"]);
  });

  it("끝난 티켓을 지나는 관계는 순환이 아니다", async () => {
    const found = await findBlockersInCycle({
      ticket: toTicketKey("A-1"),
      blockers: [live("A-2")],
      read: graph({ "A-2": [live("A-1", "completed")] }),
    });
    expect(found.size).toBe(0);
  });

  it("자기들끼리 도는 관계에서도 끝난다", async () => {
    const found = await findBlockersInCycle({
      ticket: toTicketKey("A-1"),
      blockers: [live("A-2")],
      read: graph({ "A-2": [live("A-3")], "A-3": [live("A-2")] }),
    });
    expect(found.size).toBe(0);
  });
});

describe("대기열 순서", () => {
  const run = (id: string, minute: number, priorityRank?: number, startRequested?: boolean) => ({
    id: toRunId(id),
    assignedAt: new Date(Date.UTC(2026, 10, 21, 0, minute)),
    project: toRunnerProjectId("github:acme/app"),
    agent: toAgentId("claude"),
    runnerId: null,
    unstartable: false,
    ...(priorityRank === undefined ? {} : { priorityRank }),
    ...(startRequested === undefined ? {} : { startRequested }),
  });

  it("시작을 보낸 런, 우선순위, 먼저 온 순서로 선다(B6)", () => {
    const ordered = queueOrder([
      run("none-early", 1),
      run("low", 2, 3),
      run("urgent", 4, 0),
      run("high-late", 6, 1),
      run("high-early", 5, 1),
      run("sent", 7, 4, true),
    ]);
    expect(ordered.map((r) => r.id)).toEqual([
      "sent",
      "urgent",
      "high-early",
      "high-late",
      "low",
      "none-early",
    ]);
  });
});
