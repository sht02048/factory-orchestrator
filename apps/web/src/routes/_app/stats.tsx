import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { conditionsForStatsGroup } from "@ganger/app/runs/conditions";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getStatsPage } from "../../server/functions";
import { statsMessages } from "../../stats/messages";
import {
  DEFAULT_STATS_PERIOD_DAYS,
  STATS_DIMENSIONS,
  statsPeriodDaysSchema,
} from "@ganger/app/stats/model";
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
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: StatsRoute,
});

function StatsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
  const { by, ws } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
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
        onPickWorkspace={(next) => {
          void navigate({ search: (prev) => ({ ...prev, ws: next }) });
        }}
        runsHref={(dimension, key, days) =>
          router.buildLocation({
            to: "/runs",
            search: { ws, ...conditionsForStatsGroup(dimension, key, days) },
          }).href
        }
        onOpenRuns={(dimension, key, days) => {
          void navigate({
            to: "/runs",
            search: { ws, ...conditionsForStatsGroup(dimension, key, days) },
          });
        }}
        failedRunsHref={(days) =>
          router.buildLocation({ to: "/runs", search: { ws, f: "failed", days } }).href
        }
        onOpenFailedRuns={(days) => {
          void navigate({ to: "/runs", search: { ws, f: "failed", days } });
        }}
      />
    </ScreenMessages>
  );
}
