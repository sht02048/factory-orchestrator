import type { SummaryOutcome } from "@ganger/core";
import { describe, expect, it } from "vitest";
import {
  TICKET_FILTERS,
  countByFilter,
  matchesFilter,
  matchesSearch,
} from "@ganger/app/tickets/model";
import type { TicketFilter, TicketRun, TicketView } from "@ganger/app/tickets/model";

function ticket(key: string, title: string, runs: TicketRun[]): TicketView {
  return {
    id: key,
    connection: "acme",
    key,
    title,
    url: null,
    trackerProject: { id: "web", name: "Web" },
    trackerState: { name: "Todo", category: "unstarted" },
    labels: [],
    runs,
    mapping: null,
    assignability: { kind: "no-mapping" },
  };
}

function active(state: "queued" | "running" | "waiting-for-input" | "disconnected"): TicketRun {
  return { id: `run-${state}`, runnerName: null, state, elapsedMs: 0 };
}

function ended(summary: SummaryOutcome, prSettledLater = false): TicketRun {
  return {
    id: `run-${summary}`,
    runnerName: null,
    state: "ended",
    endedAt: "2026-11-18T00:00:00.000Z",
    endedAgoMs: 0,
    agentResult: "reported-success",
    prState: "open",
    summary,
    prSettledLater,
  };
}

function filtersOf(view: TicketView): TicketFilter[] {
  return TICKET_FILTERS.filter((filter) => matchesFilter(view, filter));
}

describe("Tickets 필터(GLOSSARY Tickets 필터, 0068)", () => {
  it.each<[string, TicketRun[], TicketFilter[]]>([
    ["런이 없음", [], ["all", "assignable"]],
    ["Failed", [ended("failed")], ["all", "assignable", "todo"]],
    ["Canceled", [ended("canceled")], ["all", "assignable", "done"]],
    ["Waiting for Input", [active("waiting-for-input")], ["all", "todo"]],
    ["Disconnected", [active("disconnected")], ["all", "todo"]],
    ["Human Check", [ended("human-check")], ["all", "todo"]],
    ["이후 PR 상태가 기록된 Human Check", [ended("human-check", true)], ["all", "done"]],
    ["Queued", [active("queued")], ["all", "in-progress"]],
    ["Running", [active("running")], ["all", "in-progress"]],
    ["Merged", [ended("merged")], ["all", "done"]],
  ])("마지막 런이 %s인 티켓", (_, runs, expected) => {
    expect(filtersOf(ticket("ACME-1", "결제", runs))).toEqual(expected);
  });

  it("마지막 런(가장 최근)으로만 정한다", () => {
    const view = ticket("ACME-1", "결제", [ended("merged"), ended("failed")]);
    expect(filtersOf(view)).toEqual(["all", "done"]);
  });

  it("필터마다 개수를 센다", () => {
    expect(
      countByFilter([
        ticket("ACME-1", "a", []),
        ticket("ACME-2", "b", [ended("failed")]),
        ticket("ACME-3", "c", [ended("canceled")]),
        ticket("ACME-4", "d", [active("running")]),
      ]),
    ).toEqual({ all: 4, assignable: 3, todo: 1, "in-progress": 1, done: 1 });
  });
});

describe("Tickets 검색", () => {
  const view = ticket("ACME-12", "Checkout retry", []);

  it("키나 제목의 일부로 찾고 대소문자를 가리지 않는다", () => {
    expect(matchesSearch(view, "acme-1")).toBe(true);
    expect(matchesSearch(view, "RETRY")).toBe(true);
    expect(matchesSearch(view, "  checkout ")).toBe(true);
    expect(matchesSearch(view, "")).toBe(true);
    expect(matchesSearch(view, "ACME-13")).toBe(false);
    expect(matchesSearch(view, "invoice")).toBe(false);
  });
});
