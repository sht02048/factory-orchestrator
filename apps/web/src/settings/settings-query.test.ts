import { describe, expect, it } from "vitest";
import type { BoundProjectReads } from "@ganger/app/settings/model";
import { DB_STALE_TIME_MS } from "../query/query-client";
import { TRACKER_STALE_TIME_MS } from "../tickets/tickets-query";
import { trackerReadStaleTime, withSharedLabels } from "./settings-query";

const read = (labels: BoundProjectReads["labels"]): BoundProjectReads => ({
  connection: "conn-acme",
  projectId: "tp-web",
  states: { ok: true, items: [] },
  labels,
});

describe("Settings 의 트래커 query(0128)", () => {
  it("트래커를 모두 읽었으면 5분, 하나라도 못 읽었으면 DB 데이터와 같은 30초 동안 새것으로 본다", () => {
    expect(trackerReadStaleTime([{ ok: true, items: [] }])).toBe(TRACKER_STALE_TIME_MS);
    expect(
      trackerReadStaleTime([
        { ok: true, items: [] },
        { ok: false, error: "network" },
      ]),
    ).toBe(DB_STALE_TIME_MS);
    expect(trackerReadStaleTime(undefined)).toBe(TRACKER_STALE_TIME_MS);
  });

  it("Tickets 와 함께 쓰는 라벨 key 의 값을 보이되, 이번 읽기가 실패했으면 실패를 보인다", () => {
    const fresh = { ok: true as const, items: [{ id: "lb-new", name: "new" }] };
    expect(withSharedLabels([read({ ok: true, items: [] })], [fresh])[0]?.labels).toEqual(fresh);
    expect(withSharedLabels([read({ ok: false, error: "network" })], [fresh])[0]?.labels).toEqual({
      ok: false,
      error: "network",
    });
    expect(withSharedLabels([read({ ok: true, items: [] })], [undefined])[0]?.labels).toEqual({
      ok: true,
      items: [],
    });
  });
});
