import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { resolveWorkspace } from "@ganger/app/shell/model";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getSettingsPage } from "../../server/settings-functions";
import { settingsMessages } from "../../settings/messages";
import { SettingsScreen } from "../../settings/settings-page";
import { NavigationGuard } from "../../settings/navigation-guard";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getSettingsPage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const page = Route.useLoaderData();
  const { ws } = Route.useSearch();
  const shell = useLoaderData({ from: "/_app" });
  const actions = useSettingsActions();
  return (
    <ScreenMessages messages={settingsMessages}>
      <SettingsScreen
        page={page}
        runnerIssues={shell.runnerIssues}
        workspaceView={resolveWorkspace(shell.workspaces, ws).kind}
        ws={ws}
        actions={actions}
        renderLink={routerSettingsLink}
        renderGuard={(guard) => <NavigationGuard {...guard} />}
      />
    </ScreenMessages>
  );
}
