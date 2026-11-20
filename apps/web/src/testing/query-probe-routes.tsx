import { Text } from "@ganger/ui";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../query/route-query";
import { Route as appLayoutRoute } from "../routes/_app";
import { routeTree as appRouteTree } from "../routeTree.gen";
import { getTimeZone } from "../server/functions";

const QUERY_PROBE_PATH = "/query-probe";
const QUERY_PROBE_AWAY_PATH = "/query-probe-away";
const QUERY_PROBE_ERROR_PATH = "/query-probe-error";
const QUERY_PROBE_SHELL_ERROR_PATH = "/query-probe-shell-error";
const QUERY_PROBE_ERROR_MESSAGE = "query-probe-read-failed";
const QUERY_PROBE_ID = "query-probe";
const QUERY_PROBE_AWAY_ID = "query-probe-away";

const probeQuery = queryOptions({
  queryKey: ["query-probe", "time-zone"],
  queryFn: ({ signal }) => getTimeZone({ signal }),
});

const failingProbeQuery = queryOptions({
  queryKey: ["query-probe", "failing"],
  queryFn: (): Promise<string> => Promise.reject(new Error(QUERY_PROBE_ERROR_MESSAGE)),
  retryDelay: 0,
});

function QueryProbe() {
  const { data } = useSuspenseQuery(probeQuery);
  return (
    <Text variant="body" id={QUERY_PROBE_ID}>
      {data}
    </Text>
  );
}

function QueryProbeAway() {
  return (
    <Text variant="body" id={QUERY_PROBE_AWAY_ID}>
      {QUERY_PROBE_AWAY_PATH}
    </Text>
  );
}

const probeRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_PATH,
  preloadStaleTime: 0,
  loader: (load) => loadRouteQuery(load, probeQuery),
  component: QueryProbe,
});

const awayRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_AWAY_PATH,
  component: QueryProbeAway,
});

const errorRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_ERROR_PATH,
  loader: (load) => loadRouteQuery(load, failingProbeQuery),
  component: QueryProbe,
});

const shellErrorRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: QUERY_PROBE_SHELL_ERROR_PATH,
  loader: (load) => loadRouteQuery(load, failingProbeQuery),
  component: QueryProbe,
});

function isRoute(value: unknown): value is AnyRoute {
  return typeof value === "object" && value !== null && "id" in value && "options" in value;
}

function childRoutesOf(route: { children?: unknown }): AnyRoute[] {
  const children = route.children;
  if (typeof children !== "object" || children === null) return [];
  return Object.values(children).filter(isRoute);
}

appLayoutRoute.addChildren([...childRoutesOf(appLayoutRoute), shellErrorRoute]);

export const routeTree = appRouteTree.addChildren([
  ...childRoutesOf(appRouteTree),
  probeRoute,
  awayRoute,
  errorRoute,
]);
