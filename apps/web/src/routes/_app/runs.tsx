import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runsMessages } from "../../runs/messages";
import { RUN_FILTERS } from "../../runs/model";
import { RunsScreen } from "../../runs/runs-screen";
import { getRunsPage } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: runsMessages, namespace: "runs" });
const appRoute = getRouteApi("/_app");

/** Runs: 현재 Workspace 의 런. 필터(f)와 고른 런(sel)은 주소에 남는다 */
export const Route = createFileRoute("/_app/runs")({
  validateSearch: z.object({
    f: z.enum(RUN_FILTERS).optional().catch(undefined),
    sel: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getRunsPage({ data: { ws: deps.ws } }),
  // 필터·행을 고를 때마다 다시 읽지 않는다. Workspace 를 바꾸면 deps 가 바뀌어 새로 읽는다.
  shouldReload: false,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunsRoute,
});

function RunsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
  const { f, sel, ws } = Route.useSearch();
  const navigate = Route.useNavigate();
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
        onPickWorkspace={(next) => {
          void navigate({ search: (prev) => ({ ...prev, ws: next, sel: undefined }) });
        }}
        runHref={(id) =>
          `/runs/${encodeURIComponent(id)}${ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`}`
        }
      />
    </ScreenMessages>
  );
}
