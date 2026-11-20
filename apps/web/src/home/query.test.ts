import { completeRunControlRequest, requestRunControl } from "@ganger/db";
import { loadHomePage } from "@ganger/app/home/load";
import { describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";
import { statsQuery } from "../stats/query";
import { CONTROL_POLL_MS, dashboardQuery, pollWhileControlPending } from "./query";

describe("Dashboard·Stats query(스펙 0003 4.3)", () => {
  it("key는 Workspace와 시간대를 담고, Workspace가 없으면 빈 값을 넣는다", () => {
    expect(dashboardQuery("ws-commerce", "Asia/Seoul").queryKey).toEqual([
      "dashboard",
      "ws-commerce",
      "Asia/Seoul",
    ]);
    expect(dashboardQuery(undefined, "UTC").queryKey).toEqual(["dashboard", null, "UTC"]);
    expect(statsQuery("ws-commerce", 7, "Asia/Seoul").queryKey).toEqual([
      "stats",
      "ws-commerce",
      7,
      "Asia/Seoul",
    ]);
    expect(statsQuery(undefined, 14, "UTC").queryKey).toEqual(["stats", null, 14, "UTC"]);
  });

  it("시간대가 다르면 다른 key라 새로 읽는다", () => {
    expect(dashboardQuery("ws-commerce", "UTC").queryKey).not.toEqual(
      dashboardQuery("ws-commerce", "Asia/Seoul").queryKey,
    );
    expect(statsQuery("ws-commerce", 14, "UTC").queryKey).not.toEqual(
      statsQuery("ws-commerce", 14, "Asia/Seoul").queryKey,
    );
  });
});

describe("멈추기·재개 처리 중 다시 읽기(스펙 0003 4.5)", () => {
  it("처리 중인 멈추기·재개가 있는 동안만 2초마다 다시 읽는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const read = () => ({ state: { data: loadHomePage(db, "ws-commerce", now, "UTC") } });

    expect(pollWhileControlPending(read())).toBe(false);
    requestRunControl(db, id, "pause", minutes(110));
    expect(pollWhileControlPending(read())).toBe(CONTROL_POLL_MS);
    completeRunControlRequest(db, {
      runId: id,
      requestedAt: minutes(110),
      completedAt: minutes(111),
      error: null,
    });
    expect(pollWhileControlPending(read())).toBe(false);
  });

  it("아직 읽은 값이 없으면 다시 읽지 않는다", () => {
    expect(pollWhileControlPending({ state: { data: undefined } })).toBe(false);
  });
});
