import { z } from "zod";

/*
 * 화면 시각과 날짜를 그리는 시간대(티켓 0044). 운영자 브라우저의 시간대를 쓴다.
 *
 * - 브라우저가 자기 시간대를 쿠키(TIME_ZONE_COOKIE)에 남기고, 서버는 요청의 쿠키로 같은 시간대를 골라
 *   그린다. 그래서 서버 렌더링과 hydration 이 같은 값을 그린다.
 * - 쿠키가 없는 첫 방문은 UTC 로 그린 뒤, 브라우저가 쿠키를 남기고 시간대를 쓰는 데이터를 다시 읽는다
 *   (TimeZoneSync, routes/__root.tsx).
 * - 쿠키는 밖에서 온 값이라 IANA 시간대 이름으로 읽히는지 확인하고 Intl 이 쓰는 이름으로 바꾼다.
 *   아니면 UTC 로 그린다. 대소문자만 다른 이름이나 오프셋(+09:00)을 그대로 받으면 서버의 포맷터 캐시가
 *   요청마다 늘어날 수 있다.
 */

export const DEFAULT_TIME_ZONE = "UTC";
export const TIME_ZONE_COOKIE = "tz";

/** Intl 이 아는 IANA 시간대 이름이면 Intl 이 쓰는 이름(aSiA/sEoUl → Asia/Seoul), 아니면 null */
function canonicalTimeZone(value: string): string | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    // 오프셋(+09:00)은 IANA 이름이 아니다. 브라우저는 이름을 준다.
    return /^[A-Za-z]/.test(name) ? name : null;
  } catch {
    return null;
  }
}

const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .transform((value, context) => {
    const name = canonicalTimeZone(value);
    if (name === null) {
      context.addIssue({ code: "custom", message: "not an IANA time zone" });
      return z.NEVER;
    }
    return name;
  });

/** 밖에서 온 시간대 값을 읽어 Intl 이 쓰는 이름으로 바꾼다. 시간대 이름이 아니면 UTC 다 */
export function parseTimeZone(value: unknown): string {
  const parsed = timeZoneSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TIME_ZONE;
}

/** 이 브라우저(또는 프로세스)의 시간대 */
export function localTimeZone(): string {
  return parseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** document.cookie 같은 쿠키 문자열에서 시간대 쿠키 값. 없으면 null */
export function timeZoneFromCookies(cookies: string): string | null {
  for (const pair of cookies.split(";")) {
    const [name, value] = pair.trim().split("=", 2);
    if (name === TIME_ZONE_COOKIE && value !== undefined) return value;
  }
  return null;
}

/**
 * 브라우저가 시간대를 남기는 쿠키. 1년 동안 두고 같은 사이트의 모든 경로에 보낸다.
 * IANA 시간대 이름은 쿠키 값에 쓸 수 있는 글자(영문, 숫자, / _ + -)만 써서 인코딩하지 않는다.
 */
export function timeZoneCookie(timeZone: string): string {
  return `${TIME_ZONE_COOKIE}=${timeZone}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** 하루(밀리초) */
export const DAY_MS = 24 * 60 * 60 * 1000;
const dayParts = new Map<string, Intl.DateTimeFormat>();

/**
 * 그 시각이 시간대에서 드는 날짜. 날짜를 그 날 UTC 0시의 epoch 밀리초로 나타낸다.
 * 날짜끼리는 언제나 DAY_MS 씩 떨어져 날을 세기 쉽고, 날짜를 쓸 때는 getUTC* 로 읽는다.
 */
export function calendarDay(at: Date, timeZone: string): number {
  let format = dayParts.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    dayParts.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  const part = (type: "year" | "month" | "day"): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}
