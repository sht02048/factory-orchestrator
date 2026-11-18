import { z } from "zod";

export const DEFAULT_TIME_ZONE = "UTC";
export const TIME_ZONE_COOKIE = "tz";

function canonicalTimeZone(value: string): string | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
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

export function parseTimeZone(value: unknown): string {
  const parsed = timeZoneSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TIME_ZONE;
}

export function localTimeZone(): string {
  return parseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function timeZoneFromCookies(cookies: string): string | null {
  for (const pair of cookies.split(";")) {
    const [name, value] = pair.trim().split("=", 2);
    if (name === TIME_ZONE_COOKIE && value !== undefined) return value;
  }
  return null;
}

export function timeZoneCookie(timeZone: string): string {
  return `${TIME_ZONE_COOKIE}=${timeZone}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
const dayParts = new Map<string, Intl.DateTimeFormat>();

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
