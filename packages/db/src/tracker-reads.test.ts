import { toTrackerConnectionId } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { connection, seededDatabase } from "./test-fixtures.js";
import {
  markAllTrackersChanged,
  markTrackerChanged,
  trackerReadGeneration,
} from "./tracker-reads.js";

describe("트래커 읽기 세대", () => {
  it("바뀐 적 없는 연결은 0 이고, 바뀔 때마다 그 연결만 하나씩 오른다", () => {
    const db = seededDatabase();
    const other = toTrackerConnectionId("conn-2");
    expect(trackerReadGeneration(db, connection)).toBe(0);

    markTrackerChanged(db, connection);
    markTrackerChanged(db, connection);

    expect(trackerReadGeneration(db, connection)).toBe(2);
    expect(trackerReadGeneration(db, other)).toBe(0);
  });

  it("모두 다시 읽기는 저장된 모든 트래커 연결을 하나씩 올린다", () => {
    const db = seededDatabase();
    markTrackerChanged(db, connection);
    markAllTrackersChanged(db);
    expect(trackerReadGeneration(db, connection)).toBe(2);
  });
});
