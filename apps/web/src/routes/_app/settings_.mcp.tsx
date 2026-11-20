import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadRouteQuery } from "../../query/route-query";
import { McpScreen } from "../../settings/mcp-screen";
import { settingsMessages } from "../../settings/messages";
import { settingsQuery } from "../../settings/settings-query";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/mcp")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  preloadStaleTime: 0,
  loader: async (load) => {
    await loadRouteQuery(load, settingsQuery(load.deps.ws));
  },
  head: () => ({ meta: [{ title: t("project.documentTitle", { name: t("mcp.title") }) }] }),
  component: McpRoute,
});

function McpRoute() {
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const actions = useSettingsActions(useSettingsQueryRefresh());
  return (
    <ScreenMessages messages={settingsMessages}>
      <McpScreen mcp={page.install.mcp} ws={ws} actions={actions} renderLink={routerSettingsLink} />
    </ScreenMessages>
  );
}
