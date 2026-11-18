import { Link, createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getSettingsPage } from "../../server/settings-functions";
import { settingsMessages } from "../../settings/messages";
import { SettingsScreen } from "../../settings/settings-screen";
import { useSettingsActions } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings")({
  validateSearch: z.object({ sel: z.string().optional() }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getSettingsPage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const page = Route.useLoaderData();
  const { sel } = Route.useSearch();
  const navigate = Route.useNavigate();
  const actions = useSettingsActions();

  return (
    <ScreenMessages messages={settingsMessages}>
      <SettingsScreen
        page={page}
        selected={sel}
        onSelect={(item) => {
          void navigate({ search: (prev) => ({ ...prev, sel: item }), replace: true });
        }}
        actions={actions}
        renderRunnersLink={(props) => <Link to="/runners" {...props} />}
      />
    </ScreenMessages>
  );
}
