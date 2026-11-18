import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getStatsPage } from "../../server/functions";
import { statsMessages } from "../../stats/messages";
import {
  DEFAULT_STATS_PERIOD_DAYS,
  STATS_DIMENSIONS,
  statsPeriodDaysSchema,
} from "../../stats/model";
import { StatsScreen } from "../../stats/stats-screen";

const t = createTranslator({ locale: defaultLocale, messages: statsMessages, namespace: "stats" });
const appRoute = getRouteApi("/_app");

export const Route = createFileRoute("/_app/stats")({
  validateSearch: z.object({
    by: z.enum(STATS_DIMENSIONS).optional().catch(undefined),
    days: statsPeriodDaysSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws, days: search.days }),
  loader: ({ deps }) =>
    getStatsPage({ data: { ws: deps.ws, days: deps.days ?? DEFAULT_STATS_PERIOD_DAYS } }),
  shouldReload: false,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: StatsRoute,
});

function StatsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
  const { by } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ScreenMessages messages={statsMessages}>
      <StatsScreen
        page={page}
        workspaces={shell.workspaces}
        dimension={by ?? "runner"}
        onDimensionChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, by: next === "runner" ? undefined : next }),
            replace: true,
          });
        }}
        onPeriodChange={(next) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              days: next === DEFAULT_STATS_PERIOD_DAYS ? undefined : next,
            }),
            replace: true,
          });
        }}
        onPickWorkspace={(ws) => {
          void navigate({ search: (prev) => ({ ...prev, ws }) });
        }}
      />
    </ScreenMessages>
  );
}
