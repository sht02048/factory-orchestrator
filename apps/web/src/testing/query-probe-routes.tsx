import { Text } from "@ganger/ui";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../query/route-query";
import { Route as appLayoutRoute } from "../routes/_app";
import { routeTree as appRouteTree } from "../routeTree.gen";
import { ANSWER_REJECT_REASONS, rejectedAs } from "../query/mutation-error";
import { answerQuestion, getTimeZone } from "../server/functions";
import { ScreenError } from "../shell/screen-error";

const QUERY_PROBE_PATH = "/query-probe";
const QUERY_PROBE_AWAY_PATH = "/query-probe-away";
const QUERY_PROBE_ERROR_PATH = "/query-probe-error";
const QUERY_PROBE_SHELL_ERROR_PATH = "/query-probe-shell-error";
const QUERY_PROBE_ERROR_MESSAGE = "query-probe-read-failed";
const QUERY_PROBE_RETRY_PATH = "/stats/query-probe-retry";
const QUERY_PROBE_RENDER_RETRY_PATH = "/stats/query-probe-render-retry";
const QUERY_PROBE_HEAL_FLAG = "__gangerQueryProbeHealed";
const QUERY_PROBE_RUN_PATH = "/query-probe-run";
const QUERY_PROBE_ANSWER_PATH = "/query-probe-answer";
const QUERY_PROBE_ID = "query-probe";
const QUERY_PROBE_RUN_ID = "query-probe-run";
const QUERY_PROBE_ANSWER_ID = "query-probe-answer";
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

function probeHealed(): boolean {
  return typeof window !== "undefined" && Reflect.get(window, QUERY_PROBE_HEAL_FLAG) === true;
}

const healingProbeQuery = queryOptions({
  queryKey: ["query-probe", "healing"],
  queryFn: (): Promise<string> =>
    probeHealed()
      ? Promise.resolve(QUERY_PROBE_RETRY_PATH)
      : Promise.reject(new Error(QUERY_PROBE_ERROR_MESSAGE)),
  retryDelay: 0,
});

const healingRenderProbeQuery = queryOptions({
  queryKey: ["query-probe", "healing-render"],
  queryFn: (): Promise<string> =>
    probeHealed()
      ? Promise.resolve(QUERY_PROBE_RENDER_RETRY_PATH)
      : Promise.reject(new Error(QUERY_PROBE_ERROR_MESSAGE)),
  retryDelay: 0,
});

function QueryProbeHealingRender() {
  const { data } = useSuspenseQuery(healingRenderProbeQuery);
  return (
    <Text variant="body" id={QUERY_PROBE_ID}>
      {data}
    </Text>
  );
}

function QueryProbeHealing() {
  const { data } = useSuspenseQuery(healingProbeQuery);
  return (
    <Text variant="body" id={QUERY_PROBE_ID}>
      {data}
    </Text>
  );
}

const runProbeQuery = queryOptions({
  queryKey: ["runs", "detail", "query-probe"],
  queryFn: ({ signal }) => getTimeZone({ signal }),
});

function QueryProbeRun() {
  const { data, dataUpdatedAt } = useSuspenseQuery(runProbeQuery);
  return (
    <Text variant="body" id={QUERY_PROBE_RUN_ID} data-updated-at={dataUpdatedAt}>
      {data}
    </Text>
  );
}

function reasonOf(value: unknown): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, "reason") : undefined;
}

function describeRejection(error: unknown) {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  return {
    name: error instanceof Error ? error.name : null,
    reason: reasonOf(error) ?? null,
    causeReason: reasonOf(cause) ?? null,
  };
}

function QueryProbeAnswer() {
  const [outcome, setOutcome] = useState("pending");
  useEffect(() => {
    rejectedAs(
      () =>
        answerQuestion({
          data: {
            runId: "missing-run",
            requestId: "query-probe-request",
            questionId: "missing",
            answer: "네",
          },
        }),
      ANSWER_REJECT_REASONS,
    ).then(
      () => setOutcome("resolved"),
      (error: unknown) => setOutcome(JSON.stringify(describeRejection(error))),
    );
  }, []);
  return (
    <Text variant="body" id={QUERY_PROBE_ANSWER_ID}>
      {outcome}
    </Text>
  );
}

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
  loader: (load) => loadRouteQuery(load, probeQuery),
  component: QueryProbe,
});

const awayRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_AWAY_PATH,
  component: QueryProbeAway,
});

const runRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: QUERY_PROBE_RUN_PATH,
  loader: (load) => loadRouteQuery(load, runProbeQuery),
  component: QueryProbeRun,
});

const answerRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_ANSWER_PATH,
  component: QueryProbeAnswer,
});

const errorRoute = createRoute({
  getParentRoute: () => appRouteTree,
  path: QUERY_PROBE_ERROR_PATH,
  loader: (load) => loadRouteQuery(load, failingProbeQuery),
  component: QueryProbe,
});

const shellErrorRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  errorComponent: ScreenError,
  path: QUERY_PROBE_SHELL_ERROR_PATH,
  loader: (load) => loadRouteQuery(load, failingProbeQuery),
  component: QueryProbe,
});

const retryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: QUERY_PROBE_RETRY_PATH,
  errorComponent: ScreenError,
  loader: (load) => loadRouteQuery(load, healingProbeQuery),
  component: QueryProbeHealing,
});

const renderRetryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: QUERY_PROBE_RENDER_RETRY_PATH,
  errorComponent: ScreenError,
  component: QueryProbeHealingRender,
});

function isRoute(value: unknown): value is AnyRoute {
  return typeof value === "object" && value !== null && "id" in value && "options" in value;
}

function childRoutesOf(route: { children?: unknown }): AnyRoute[] {
  const children = route.children;
  if (typeof children !== "object" || children === null) return [];
  return Object.values(children).filter(isRoute);
}

appLayoutRoute.addChildren([
  ...childRoutesOf(appLayoutRoute),
  shellErrorRoute,
  retryRoute,
  renderRetryRoute,
  runRoute,
]);

export const routeTree = appRouteTree.addChildren([
  ...childRoutesOf(appRouteTree),
  probeRoute,
  awayRoute,
  errorRoute,
  answerRoute,
]);
