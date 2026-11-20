import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { getRouteApi, rootRouteId } from "@tanstack/react-router";
import { TIME_ZONE_COOKIE, parseTimeZone, timeZoneFromCookies } from "@ganger/app/time-zone";

export const requestTimeZone = createIsomorphicFn()
  .server((): string => parseTimeZone(getCookie(TIME_ZONE_COOKIE)))
  .client((): string => parseTimeZone(timeZoneFromCookies(document.cookie)));

const rootRoute = getRouteApi(rootRouteId);

export function useRequestTimeZone(): string {
  rootRoute.useLoaderData({ select: (root) => root.timeZone });
  return requestTimeZone();
}
