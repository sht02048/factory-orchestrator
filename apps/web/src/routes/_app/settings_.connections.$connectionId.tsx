import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadRouteQuery } from "../../query/route-query";
import { ConnectionDetailScreen, findConnection } from "../../settings/connection-detail";
import { settingsMessages } from "../../settings/messages";
import { NavigationGuard } from "../../settings/navigation-guard";
import { settingsQuery, webhookSetupQuery } from "../../settings/settings-query";
import { useTitleFollowsQuery } from "../../settings/route-title";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/connections/$connectionId")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  preloadStaleTime: 0,
  loader: async (load) => {
    const [page] = await Promise.all([
      loadRouteQuery(load, settingsQuery(load.deps.ws)),
      loadRouteQuery(load, webhookSetupQuery),
    ]);
    return findConnection(page, load.params.connectionId)?.name ?? null;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined || loaderData === null
            ? t("documentTitle")
            : t("connection.documentTitle", { name: loaderData }),
      },
    ],
  }),
  component: ConnectionDetailRoute,
});

function ConnectionDetailRoute() {
  const { connectionId } = Route.useParams();
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const { data: setup } = useSuspenseQuery(webhookSetupQuery);
  const actions = useSettingsActions(useSettingsQueryRefresh());
  useTitleFollowsQuery(
    Route.id,
    Route.useLoaderData(),
    findConnection(page, connectionId)?.name ?? null,
  );
  return (
    <ScreenMessages messages={settingsMessages}>
      <ConnectionDetailScreen
        page={page}
        setup={setup}
        connectionId={connectionId}
        ws={ws}
        actions={actions}
        renderLink={routerSettingsLink}
        renderGuard={(guard) => <NavigationGuard {...guard} />}
      />
    </ScreenMessages>
  );
}
