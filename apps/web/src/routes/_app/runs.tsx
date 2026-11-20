import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { pickConditions, runConditionsSearch } from "@ganger/app/runs/conditions";
import type { ConditionKey } from "@ganger/app/runs/conditions";
import { runsMessages } from "../../runs/messages";
import { ENDED_RUNS_PAGE_SIZE, MAX_ENDED_RUNS, RUN_FILTERS } from "@ganger/app/runs/model";
import { RunsScreen } from "../../runs/runs-screen";
import { requestTimeZone, useRequestTimeZone } from "../../query/request-time-zone";
import { loadRouteQuery } from "../../query/route-query";
import { runsListQuery } from "../../runs/queries";
import { useShell } from "../../shell/shell-query";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({ locale: defaultLocale, messages: runsMessages, namespace: "runs" });

export const Route = createFileRoute("/_app/runs")({
  errorComponent: ScreenError,
  validateSearch: z.object({
    f: z.enum(RUN_FILTERS).optional().catch(undefined),
    sel: z.string().optional(),
    ended: z.number().int().min(1).max(MAX_ENDED_RUNS).optional().catch(undefined),
    ...runConditionsSearch,
  }),
  loaderDeps: ({ search }) => ({
    ws: search.ws,
    ended: search.ended,
    ...pickConditions(search),
  }),
  loader: (load) =>
    loadRouteQuery(
      load,
      runsListQuery(
        { ...load.deps, ended: load.deps.ended ?? ENDED_RUNS_PAGE_SIZE },
        requestTimeZone(),
      ),
    ),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunsRoute,
});

function RunsRoute() {
  const deps = Route.useLoaderDeps();
  const timeZone = useDeferredValue(useRequestTimeZone());
  const { data: page } = useSuspenseQuery(
    runsListQuery({ ...deps, ended: deps.ended ?? ENDED_RUNS_PAGE_SIZE }, timeZone),
  );
  const shell = useShell();
  const { f, sel, ws, ended } = Route.useSearch();
  const navigate = Route.useNavigate();
  const nextEnded = (ended ?? ENDED_RUNS_PAGE_SIZE) + ENDED_RUNS_PAGE_SIZE;
  return (
    <ScreenMessages messages={runsMessages}>
      <RunsScreen
        page={page}
        workspaces={shell.workspaces}
        filter={f ?? "all"}
        selectedId={sel}
        onFilterChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, f: next === "all" ? undefined : next, sel: undefined }),
            replace: true,
          });
        }}
        onSelect={(id) => {
          void navigate({ search: (prev) => ({ ...prev, sel: id }), replace: true });
        }}
        onOpen={(id) => {
          void navigate({ to: "/runs/$runId", params: { runId: id }, search: { ws } });
        }}
        onPickWorkspace={(next) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              ws: next,
              sel: undefined,
              ended: undefined,
              runner: undefined,
              project: undefined,
              agent: undefined,
            }),
          });
        }}
        {...(nextEnded > MAX_ENDED_RUNS
          ? {}
          : {
              onShowMoreEnded: () => {
                void navigate({
                  search: (prev) => ({ ...prev, ended: nextEnded }),
                  replace: true,
                  resetScroll: false,
                });
              },
            })}
        onClearConditions={(keys: ReadonlyArray<ConditionKey>) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              ...Object.fromEntries(keys.map((key) => [key, undefined])),
              sel: undefined,
              ended: undefined,
            }),
            replace: true,
          });
        }}
        runHref={(id) =>
          `/runs/${encodeURIComponent(id)}${ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`}`
        }
      />
    </ScreenMessages>
  );
}
