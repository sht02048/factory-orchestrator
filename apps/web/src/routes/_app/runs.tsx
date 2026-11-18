import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { pickConditions, runConditionsSearch } from "../../runs/conditions";
import type { ConditionKey } from "../../runs/conditions";
import { runsMessages } from "../../runs/messages";
import { ENDED_RUNS_PAGE_SIZE, MAX_ENDED_RUNS, RUN_FILTERS } from "../../runs/model";
import { RunsScreen } from "../../runs/runs-screen";
import { getRunsPage } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: runsMessages, namespace: "runs" });
const appRoute = getRouteApi("/_app");

export const Route = createFileRoute("/_app/runs")({
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
  loader: ({ deps }) =>
    getRunsPage({ data: { ...deps, ended: deps.ended ?? ENDED_RUNS_PAGE_SIZE } }),
  shouldReload: false,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunsRoute,
});

function RunsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
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
