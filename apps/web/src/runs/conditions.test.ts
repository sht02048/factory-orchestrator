import { describe, expect, it } from "vitest";
import {
  conditionsForStatsGroup,
  parseTrackerProjectKey,
  pickConditions,
  runConditionsSchema,
  trackerProjectKey,
} from "@ganger/app/runs/conditions";

describe("Runs 조건", () => {
  it("트래커 프로젝트 키는 콜론이 든 이름도 되돌리고, 모양이 틀리면 버린다", () => {
    const key = trackerProjectKey("conn:a", "tp/1:b");
    expect(parseTrackerProjectKey(key)).toEqual({ connection: "conn:a", project: "tp/1:b" });
    expect(parseTrackerProjectKey("no-colon")).toBeNull();
    expect(parseTrackerProjectKey("a:b:c")).toBeNull();
    expect(parseTrackerProjectKey(":b")).toBeNull();
    expect(parseTrackerProjectKey("%E0%A4%A:b")).toBeNull();
  });

  it("서버 함수 입력은 모양이 틀린 조건을 거부한다", () => {
    expect(runConditionsSchema.safeParse({ project: "nope", days: 7 }).success).toBe(false);
    expect(runConditionsSchema.safeParse({ days: 5 }).success).toBe(false);
    expect(runConditionsSchema.parse({ runner: "", days: 30 })).toEqual({ runner: "", days: 30 });
  });

  it("Stats 나눠 보기 행은 그 기준의 조건과 기간이 된다", () => {
    expect(conditionsForStatsGroup("runner", "runner-a", 7)).toEqual({
      runner: "runner-a",
      days: 7,
    });
    expect(conditionsForStatsGroup("trackerProject", "conn:tp", 14)).toEqual({
      project: "conn:tp",
      days: 14,
    });
    expect(conditionsForStatsGroup("agent", "claude", 30)).toEqual({ agent: "claude", days: 30 });
  });

  it("주소의 다른 값은 빼고 조건만 고른다", () => {
    expect(pickConditions({ runner: "r", agent: undefined })).toEqual({ runner: "r" });
  });
});
