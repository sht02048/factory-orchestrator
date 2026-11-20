import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getSettingsPage, getWebhookSetup } from "../../server/settings-functions";
import { ConnectionDetailScreen, findConnection } from "../../settings/connection-detail";
import { settingsMessages } from "../../settings/messages";
import { NavigationGuard } from "../../settings/navigation-guard";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsReload } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/connections/$connectionId")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async ({ deps }) => {
    const [page, setup] = await Promise.all([
      getSettingsPage({ data: { ws: deps.ws } }),
      getWebhookSetup(),
    ]);
    return { page, setup };
  },
  head: ({ loaderData, params }) => {
    const connection =
      loaderData === undefined ? null : findConnection(loaderData.page, params.connectionId);
    return {
      meta: [
        {
          title:
            connection === null
              ? t("documentTitle")
              : t("connection.documentTitle", { name: connection.name }),
        },
      ],
    };
  },
  component: ConnectionDetailRoute,
});

function ConnectionDetailRoute() {
  const { page, setup } = Route.useLoaderData();
  const { connectionId } = Route.useParams();
  const { ws } = Route.useSearch();
  const actions = useSettingsActions(useSettingsReload());
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
