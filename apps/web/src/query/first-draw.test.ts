import { describe, expect, it } from "vitest";
import { nextFirstDraw } from "./first-draw";
import type { FirstDraw } from "./first-draw";

const settled: FirstDraw = { ws: "a", catchingUp: false, generation: 3 };

describe("Workspace 전환 뒤 처음 그리기(0154)", () => {
  it("Workspace 를 바꾸면 새로 그린다", () => {
    expect(nextFirstDraw(settled, "b", false)).toEqual({
      ws: "b",
      catchingUp: false,
      generation: 4,
    });
  });

  it("바꾼 뒤 다시 읽는 중이면 그 결과가 올 때 한 번 더 새로 그린다", () => {
    const switched = nextFirstDraw(settled, "b", true);
    expect(switched).toEqual({ ws: "b", catchingUp: true, generation: 4 });
    expect(nextFirstDraw(switched, "b", true)).toBe(switched);
    expect(nextFirstDraw(switched, "b", false)).toEqual({
      ws: "b",
      catchingUp: false,
      generation: 5,
    });
  });

  it("같은 Workspace 의 평소 다시 읽기는 새로 그리지 않아 움직임을 지킨다", () => {
    expect(nextFirstDraw(settled, "a", true)).toBe(settled);
    expect(nextFirstDraw(settled, "a", false)).toBe(settled);
  });
});
