import { describe, expect, it } from "vitest";
import { dayLabelShown, dayLabelShownWhenNarrow } from "./throughput-chart";

function shown(days: number, isShown: (index: number, days: number) => boolean): number[] {
  return Array.from({ length: days }, (_, i) => i).filter((i) => isShown(i, days));
}

describe("날짜 이름 고르기(0093)", () => {
  it("넓을 때는 오늘부터 거슬러 8개 안팎, 좁을 때는 4개 안팎을 보인다", () => {
    expect(shown(14, dayLabelShown)).toEqual([1, 3, 5, 7, 9, 11, 13]);
    expect(shown(14, dayLabelShownWhenNarrow)).toEqual([1, 5, 9, 13]);
    expect(shown(7, dayLabelShownWhenNarrow)).toEqual([0, 2, 4, 6]);
    expect(shown(30, dayLabelShownWhenNarrow)).toEqual([5, 13, 21, 29]);
  });

  it("좁을 때 보이는 이름은 넓을 때도 보인다. 좁아지면 이름이 빠지기만 한다", () => {
    for (const days of [7, 14, 30]) {
      const wide = shown(days, dayLabelShown);
      for (const index of shown(days, dayLabelShownWhenNarrow)) expect(wide).toContain(index);
    }
  });
});
