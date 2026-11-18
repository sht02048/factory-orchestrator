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

export const Route = createFileRoute("/_app/stats")({
  validateSearch: z.object({
    by: z.enum(STATS_DIMENSIONS).optional().catch(undefined),
    sel: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getStatsPage({ data: { ws: deps.ws } }),
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
