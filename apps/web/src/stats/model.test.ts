import { describe, expect, it } from "vitest";
import { percent, percentile, statsPeriod } from "./model";

describe("percentile", () => {
  it("nearest-rank: n 개 중 ceil(p × n) 번째 값이다", () => {
    expect(percentile([10], 0.5)).toBe(10);
    expect(percentile([10, 20], 0.5)).toBe(10);
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)).toBe(10);
  });

  it("빈 목록은 던진다", () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });
});

describe("statsPeriod", () => {
  it("오늘(UTC)을 넣어 14일이다", () => {
    const period = statsPeriod(new Date("2026-11-17T23:59:59Z"));
    expect(new Date(period.firstDay).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(new Date(period.lastDay).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });
});

describe("percent", () => {
  it("정수로 반올림하고 분모가 0 이면 null 이다", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });
});
