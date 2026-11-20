import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";
import { createTranslator } from "use-intl";
import { toRunId } from "@ganger/core";
import { z } from "zod";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import { useDashboardActions } from "../../home/mutations";
import { dashboardQuery } from "../../home/query";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { requestTimeZone } from "../../query/request-time-zone";
import { loadRouteQuery } from "../../query/route-query";

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });
const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({
    view: z.enum(["todo"]).optional().catch(undefined),
    run: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: (load) => loadRouteQuery(load, dashboardQuery(load.deps.ws, requestTimeZone())),
  preloadStaleTime: 0,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const { ws } = Route.useLoaderDeps();
  const timeZone = rootRoute.useLoaderData({ select: (root) => root.timeZone });
  const { data: page } = useSuspenseQuery(dashboardQuery(ws, timeZone));
  const { view, run } = Route.useSearch();
  const navigate = Route.useNavigate();
  const actions = useDashboardActions();
  const clearOpenRun = useCallback(() => {
    void navigate({
      search: (prev) => ({ ...prev, run: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);
  return (
    <ScreenMessages messages={homeMessages}>
      <HomeScreen
        page={page}
        view={view ?? "all"}
        onViewChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, view: next === "all" ? undefined : next }),
            replace: true,
            resetScroll: false,
          });
        }}
        onAnswer={actions.onAnswer}
        onDeny={actions.onDeny}
        onControl={actions.onControl}
        openRunId={run === undefined ? undefined : toRunId(run)}
        onOpenRunShown={clearOpenRun}
      />
    </ScreenMessages>
  );
}
