import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { useTime, type TimeFormat } from "./time";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 시간대를 주고 useTime 으로 그린 글을 돌려준다 */
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
    // UTC 11월 17일 20:00 은 서울에서 11월 18일 05:00 이다.
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

  it("시간의 양은 단위를 붙여 쓴다", () => {
    expect(draw((time) => time.duration(40 * 1000))).toBe("40초");
    expect(draw((time) => time.duration(12 * MINUTE))).toBe("12분");
    expect(draw((time) => time.duration(2 * HOUR))).toBe("2시간");
  });
});
