import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { useTime, type TimeFormat } from "./time";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function draw(use: (time: TimeFormat) => string, timeZone = "UTC"): string {
  function Probe() {
    return <>{use(useTime())}</>;
  }
  return renderWithMessages(<Probe />, {}, timeZone);
}

describe("시간 표기(ADR 0010 7번)", () => {
  it("진행 중인 것은 경과로 쓴다", () => {
    expect(draw((time) => time.elapsed(25 * MINUTE))).toBe("25분째");
    expect(draw((time) => time.elapsed(HOUR + 10 * MINUTE))).toBe("1시간 10분째");
  });

  it("지난 일은 1분 안이면 방금, 그 뒤는 상대 시간이다", () => {
    const at = "2026-11-18T01:00:00.000Z";
    expect(draw((time) => time.ago(at, 0))).toBe("방금");
    expect(draw((time) => time.ago(at, 59 * 1000))).toBe("방금");
    expect(draw((time) => time.ago(at, 25 * MINUTE))).toBe("25분 전");
    expect(draw((time) => time.ago(at, 3 * HOUR + 20 * MINUTE))).toBe("3시간 전");
  });

  it("하루가 넘으면 운영자 시간대의 날짜를 쓴다", () => {
    const at = new Date("2026-11-17T20:00:00.000Z");
    expect(draw((time) => time.ago(at, DAY + MINUTE))).toBe("11월 17일");
    expect(draw((time) => time.ago(at, DAY + MINUTE), "Asia/Seoul")).toBe("11월 18일");
  });

  it("타임라인은 운영자 시간대의 시각이다", () => {
    const at = "2026-11-18T01:45:00.000Z";
    expect(draw((time) => time.clock(at))).toBe("01:45");
    expect(draw((time) => time.clock(at), "Asia/Seoul")).toBe("10:45");
    expect(draw((time) => time.clock(at), "America/New_York")).toBe("20:45");
  });

  it("타임라인 시각은 지금과 다른 날이면 운영자 시간대의 날짜를 붙인다", () => {
    const now = "2026-11-18T03:00:00.000Z";
    expect(draw((time) => time.stamp("2026-11-18T01:45:00.000Z", now))).toBe("01:45");
    expect(draw((time) => time.stamp("2026-11-17T23:10:00.000Z", now))).toBe("11월 17일 23:10");
    expect(draw((time) => time.stamp("2026-11-17T23:10:00.000Z", now), "Asia/Seoul")).toBe("08:10");
  });

  it("통계의 하루는 날짜와 눈금으로 쓰고 시간대를 다시 적용하지 않는다", () => {
    const day = Date.UTC(2026, 10, 4);
    expect(draw((time) => time.statsDay(day).long)).toBe("11월 4일");
    expect(draw((time) => time.statsDay(day).short, "America/New_York")).toBe("11/4");
  });

  it("시간의 양은 단위를 붙여 쓴다", () => {
    expect(draw((time) => time.duration(40 * 1000))).toBe("40초");
    expect(draw((time) => time.duration(12 * MINUTE))).toBe("12분");
    expect(draw((time) => time.duration(2 * HOUR))).toBe("2시간");
  });
});

describe("앱 코드는 useTime() 밖에서 시각·날짜를 만들지 않는다(ADR 0010 7번)", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const formatting =
    /useFormatter|\.dateTime\(|\.relativeTime\(|toLocale(?:Date|Time)?String|Intl\.(?:DateTimeFormat|RelativeTimeFormat)|\.get(?:UTC)?(?:Month|Date|Day|Hours|Minutes)\(/;
  const allowed = new Set(["format/time.ts", "time-zone.ts"]);

  it("format/time.ts 밖의 앱 코드에 날짜 포매터가 없다", () => {
    const offenders = files(root)
      .map((file) => relative(root, file))
      .filter((file) => !allowed.has(file))
      .filter((file) => formatting.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
