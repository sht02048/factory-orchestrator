import { toTicketKey, toTrackerStateId } from "@ganger/core";
import type { FakeTracker } from "@ganger/core/testing";
import { describe, expect, it } from "vitest";
import { MAX_PAGES, PAGE_SIZE, loadTicketsPage, ticketId } from "./load";
import { TICKET_FILTERS, lastRun, matchesFilter } from "./model";
import type { TicketFilter, TicketView, TicketsPage } from "./model";
import { T0, connection, docsProject, labs, now, setupTickets } from "./test-fixtures";

function byKey(page: TicketsPage, key: string): TicketView {
  const found = page.tickets.find((t) => t.key === key);
  if (found === undefined) throw new Error(`no ticket ${key}`);
  return found;
}

function keysIn(page: TicketsPage, filter: TicketFilter): string[] {
  return page.tickets.filter((t) => matchesFilter(t, filter)).map((t) => t.key);
}

function addDocs(tracker: FakeTracker, total: number): void {
  for (let i = 2; i <= total; i += 1) {
    tracker.addTicket({
      key: toTicketKey(`DOC-${i}`),
      title: `DOC-${i} 제목`,
      body: "",
      url: `https://linear.example.com/acme/issue/DOC-${i}`,
      labels: [],
      project: { id: docsProject, name: "Docs" },
      state: { id: toTrackerStateId("st-todo"), name: "Todo", category: "unstarted" },
      updatedAt: T0,
    });
  }
}

describe("Tickets 읽기", () => {
  it("가짜 Tracker 의 티켓을 Workspace 트래커 프로젝트마다 읽고 마지막 런의 요약 결과를 붙인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);

    expect(page.workspace.kind).toBe("one");
    expect(page.tickets.map((t) => t.key)).toEqual([
      "ACME-6",
      "ACME-5",
      "ACME-4",
      "ACME-3",
      "ACME-2",
      "ACME-1",
      "DOC-1",
    ]);
    expect(lastRun(byKey(page, "ACME-1"))).toMatchObject({
      state: "ended",
      agentResult: "reported-success",
      prState: "merged",
      summary: "merged",
    });
    expect(lastRun(byKey(page, "ACME-2"))).toMatchObject({
      state: "ended",
      summary: "human-check",
    });
    expect(lastRun(byKey(page, "ACME-3"))).toMatchObject({ state: "running" });
    expect(lastRun(byKey(page, "ACME-4"))).toMatchObject({ state: "queued" });
    expect(lastRun(byKey(page, "ACME-6"))).toBeUndefined();
  });

  it("티켓 식별값은 주소(sel)를 거쳐도 그대로다(0054)", () => {
    const id = ticketId(connection, "ACME-6");
    const url = new URL("https://factory.example.com/tickets");
    url.searchParams.set("sel", id);
    expect(new URL(url.href).searchParams.get("sel")).toBe(id);
    expect(ticketId("a", "b-c")).not.toBe(ticketId("a-b", "c"));
  });

  it("런 이력은 새 것부터 둔다", async () => {
    const { context, ids } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const runs = byKey(page, "ACME-1").runs;
    expect(runs.map((r) => r.id)).toEqual([ids.get("ACME-1"), ids.get("ACME-1:first")]);
    expect(runs[1]).toMatchObject({ summary: "failed", agentResult: "timed-out" });
  });

  it("티켓 정보와 자동 할당 라벨, Mapping 기본값을 담는다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const ticket = byKey(page, "ACME-6");
    expect(ticket).toMatchObject({
      id: ticketId(connection, "ACME-6"),
      title: "ACME-6 제목",
      url: "https://linear.example.com/acme/issue/ACME-6",
      trackerProject: { id: "tp-web", name: "Web" },
      trackerState: { name: "Todo", category: "unstarted" },
      labels: [
        { name: "factory", autoAssign: true },
        { name: "bug", autoAssign: false },
      ],
      assignability: {
        kind: "ready",
        defaults: { runnerProject: "github:acme/web", agent: "claude" },
      },
    });
    expect(byKey(page, "DOC-1").assignability).toEqual({ kind: "no-mapping" });
  });

  it("진행 중이거나 Queued 인 런이 있는 티켓은 할당할 수 없다고 표시한다", async () => {
    const { context, ids } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    for (const key of ["ACME-3", "ACME-4", "ACME-5"]) {
      expect(byKey(page, key).assignability).toEqual({ kind: "active-run", runId: ids.get(key) });
    }
    expect(byKey(page, "ACME-1").assignability.kind).toBe("ready");
  });

  it("한 트래커 프로젝트를 읽지 못해도 나머지는 보이고 이유를 남긴다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    expect(page.errors).toEqual([{ trackerProject: "Broken", reason: "unauthorized" }]);
    expect(page.tickets.length).toBe(7);
  });

  it("상한보다 많은 트래커 프로젝트는 상한까지만 읽고 잘렸다고 남긴다(0054)", async () => {
    const { context, tracker } = setupTickets();
    const limit = MAX_PAGES * PAGE_SIZE;
    addDocs(tracker, limit + 1);
    const page = await loadTicketsPage(context, undefined, now);
    expect(page.truncated).toEqual([{ trackerProject: "Docs", limit }]);
    expect(page.tickets.filter((t) => t.trackerProject.name === "Docs")).toHaveLength(limit);
    expect(page.tickets.filter((t) => t.trackerProject.name === "Web")).toHaveLength(6);
  });

  it("상한에 꼭 맞으면 잘렸다고 하지 않는다", async () => {
    const { context, tracker } = setupTickets();
    addDocs(tracker, MAX_PAGES * PAGE_SIZE);
    const page = await loadTicketsPage(context, undefined, now);
    expect(page.truncated).toEqual([]);
    expect(page.tickets.filter((t) => t.trackerProject.name === "Docs")).toHaveLength(
      MAX_PAGES * PAGE_SIZE,
    );
  });

  it("필터: 마지막 런으로 할당할 수 있음·처리할 일·진행 중·끝남을 가른다(GLOSSARY Tickets 필터)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    expect(Object.fromEntries(TICKET_FILTERS.map((f) => [f, keysIn(page, f)]))).toEqual({
      all: ["ACME-6", "ACME-5", "ACME-4", "ACME-3", "ACME-2", "ACME-1", "DOC-1"],
      assignable: ["ACME-6", "DOC-1"],
      todo: ["ACME-5", "ACME-2"],
      "in-progress": ["ACME-4", "ACME-3"],
      done: ["ACME-1"],
    });
  });

  it("러너는 Workspace 와 상관없이 모두, 에이전트는 모든 Mapping 에서 모은다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, labs, now);
    expect(page.tickets.map((t) => t.key)).toEqual(["LAB-1"]);
    expect(page.runners.map((r) => [r.id, r.online, r.assignmentBlocked])).toEqual([
      ["runner-a", true, false],
      ["runner-b", false, false],
      ["runner-c", true, true],
      ["runner-d", true, false],
    ]);
    expect(page.agents).toEqual(["claude", "codex"]);
  });

  it('"전체"에서는 트래커를 읽지 않는다', async () => {
    const { context, tracker } = setupTickets();
    let calls = 0;
    const original = tracker.listProjectTickets.bind(tracker);
    tracker.listProjectTickets = (...args) => {
      calls += 1;
      return original(...args);
    };
    const page = await loadTicketsPage(context, "all", now);
    expect(page.workspace.kind).toBe("all");
    expect(page.tickets).toEqual([]);
    expect(calls).toBe(0);
  });
});
