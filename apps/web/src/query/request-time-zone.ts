import { getRouteApi } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { TIME_ZONE_COOKIE, parseTimeZone, timeZoneFromCookies } from "@ganger/app/time-zone";

export const requestTimeZone = createIsomorphicFn()
  .server((): string => parseTimeZone(getCookie(TIME_ZONE_COOKIE)))
  .client((): string => parseTimeZone(timeZoneFromCookies(document.cookie)));

const rootRoute = getRouteApi("__root__");

export function useRequestTimeZone(): string {
  rootRoute.useLoaderData({ select: (root) => root.timeZone });
  return requestTimeZone();
}
