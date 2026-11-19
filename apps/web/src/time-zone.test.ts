import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  calendarDay,
  parseTimeZone,
  timeZoneCookie,
  timeZoneFromCookies,
} from "@ganger/app/time-zone";

const iso = (day: number) => new Date(day).toISOString().slice(0, 10);

describe("parseTimeZone", () => {
  it("IANA 시간대 이름은 그대로 읽는다", () => {
    expect(parseTimeZone("Asia/Seoul")).toBe("Asia/Seoul");
    expect(parseTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(parseTimeZone("Etc/GMT+9")).toBe("Etc/GMT+9");
  });

  it("Intl 이 쓰는 이름으로 바꿔 같은 시간대는 값 하나다", () => {
    expect(parseTimeZone("aSiA/sEoUl")).toBe("Asia/Seoul");
    expect(parseTimeZone("utc")).toBe("UTC");
  });

  it("없거나 시간대 이름이 아니면 UTC 다", () => {
    expect(parseTimeZone("+09:00")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone("-0130")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone("")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone("Mars/Olympus")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone("Asia/Seoul; Path=/")).toBe(DEFAULT_TIME_ZONE);
    expect(parseTimeZone(9)).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("calendarDay", () => {
  it("같은 시각이라도 시간대의 날짜로 자른다", () => {
    const at = new Date("2026-11-17T17:44:00Z");
    expect(iso(calendarDay(at, "UTC"))).toBe("2026-11-17");
    expect(iso(calendarDay(at, "Asia/Seoul"))).toBe("2026-11-18");
    expect(iso(calendarDay(at, "America/Los_Angeles"))).toBe("2026-11-17");
    expect(iso(calendarDay(new Date("2026-11-18T07:59:00Z"), "America/Los_Angeles"))).toBe(
      "2026-11-17",
    );
  });

  it("서머타임이 바뀌는 날에도 날짜 하나다", () => {
    expect(iso(calendarDay(new Date("2026-11-02T07:59:00Z"), "America/Los_Angeles"))).toBe(
      "2026-11-01",
    );
    expect(iso(calendarDay(new Date("2026-11-02T08:00:00Z"), "America/Los_Angeles"))).toBe(
      "2026-11-02",
    );
  });
});

describe("timeZoneFromCookies", () => {
  it("쿠키 문자열에서 시간대 쿠키 값을 찾는다", () => {
    expect(timeZoneFromCookies("a=1; tz=Asia/Seoul; b=2")).toBe("Asia/Seoul");
    expect(timeZoneFromCookies("xtz=Asia/Seoul")).toBeNull();
    expect(timeZoneFromCookies("")).toBeNull();
  });
});

describe("timeZoneCookie", () => {
  it("모든 경로에 보내는 쿠키를 만든다", () => {
    expect(timeZoneCookie("Asia/Seoul")).toBe(
      "tz=Asia/Seoul; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});
