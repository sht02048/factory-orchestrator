import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getSettingsPage } from "../../server/settings-functions";
import { McpScreen } from "../../settings/mcp-screen";
import { settingsMessages } from "../../settings/messages";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsReload } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/mcp")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getSettingsPage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("project.documentTitle", { name: t("mcp.title") }) }] }),
  component: McpRoute,
});

function McpRoute() {
  const page = Route.useLoaderData();
  const { ws } = Route.useSearch();
  const actions = useSettingsActions(useSettingsReload());
  return (
    <ScreenMessages messages={settingsMessages}>
      <McpScreen mcp={page.install.mcp} ws={ws} actions={actions} renderLink={routerSettingsLink} />
    </ScreenMessages>
  );
}
