import { describe, expect, it } from "vitest";
import type { TrackerTicketsData } from "@ganger/app/tickets/model";
import { DB_STALE_TIME_MS } from "../query/query-client";
import { TRACKER_STALE_TIME_MS, trackerStaleTime } from "./tickets-query";

function trackerData(errors: TrackerTicketsData["errors"]): TrackerTicketsData {
  return {
    workspace: { kind: "none" },
    tickets: [],
    labels: [],
    errors,
    truncated: [],
  };
}

describe("트래커 티켓 query 의 staleTime(0127, C3)", () => {
  it("읽은 결과는 5분 동안 신선하다", () => {
    expect(trackerStaleTime(trackerData([]))).toBe(TRACKER_STALE_TIME_MS);
    expect(trackerStaleTime(undefined)).toBe(TRACKER_STALE_TIME_MS);
  });

  it("읽지 못한 트래커 프로젝트가 있으면 DB 데이터처럼 30초 뒤 낡아, 그 뒤 다시 열면 다시 읽고 창 포커스마다 트래커를 두드리지 않는다", () => {
    expect(trackerStaleTime(trackerData([{ trackerProject: "Web", reason: "rate-limited" }]))).toBe(
      DB_STALE_TIME_MS,
    );
  });
});
