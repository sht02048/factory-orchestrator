import { describe, expect, it } from "vitest";
import type { TrackerTicketsData } from "@ganger/app/tickets/model";
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

  it("읽지 못한 트래커 프로젝트가 있으면 바로 낡아, 다시 열면 뒤에서 다시 읽는다", () => {
    expect(trackerStaleTime(trackerData([{ trackerProject: "Web", reason: "rate-limited" }]))).toBe(
      0,
    );
  });
});
