import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getStatsPage } from "../../server/functions";
import { statsMessages } from "../../stats/messages";
import { STATS_DIMENSIONS } from "../../stats/model";
import { StatsScreen } from "../../stats/stats-screen";

const t = createTranslator({ locale: defaultLocale, messages: statsMessages, namespace: "stats" });
const appRoute = getRouteApi("/_app");

/** Stats: 현재 Workspace 의 통계. 나눠 보기(by)와 고른 묶음(sel)은 주소에 남는다 */
export const Route = createFileRoute("/_app/stats")({
  validateSearch: z.object({
    by: z.enum(STATS_DIMENSIONS).optional().catch(undefined),
    sel: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getStatsPage({ data: { ws: deps.ws } }),
  // 나눠 보기·행을 고를 때마다 다시 읽지 않는다. Workspace 를 바꾸면 deps 가 바뀌어 새로 읽는다.
  shouldReload: false,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: StatsRoute,
});

function StatsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
  const { by, sel } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ScreenMessages messages={statsMessages}>
      <StatsScreen
        page={page}
        workspaces={shell.workspaces}
        dimension={by ?? "runner"}
        selectedKey={sel}
        onDimensionChange={(next) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              by: next === "runner" ? undefined : next,
              sel: undefined,
            }),
            replace: true,
          });
        }}
        onSelect={(key) => {
          void navigate({ search: (prev) => ({ ...prev, sel: key }), replace: true });
        }}
        onPickWorkspace={(ws) => {
          void navigate({ search: (prev) => ({ ...prev, ws, sel: undefined }) });
        }}
      />
    </ScreenMessages>
  );
}
