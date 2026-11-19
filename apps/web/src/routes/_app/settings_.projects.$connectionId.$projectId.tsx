import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getSettingsPage, removeWorkspaceTrackerProject } from "../../server/settings-functions";
import { settingsMessages } from "../../settings/messages";
import { ProjectDetailScreen, findBoundProject } from "../../settings/project-detail";
import type { SettingsActions } from "../../settings/settings-screen";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions } from "../../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/projects/$connectionId/$projectId")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getSettingsPage({ data: { ws: deps.ws } }),
  head: ({ loaderData, params }) => {
    const bound =
      loaderData === undefined
        ? null
        : findBoundProject(loaderData.workspace, params.connectionId, params.projectId);
    return {
      meta: [
        {
          title:
            bound === null
              ? t("documentTitle")
              : t("project.documentTitle", { name: bound.project.name }),
        },
      ],
    };
  },
  component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
  const page = Route.useLoaderData();
  const { connectionId, projectId } = Route.useParams();
  const { ws } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const settingsActions = useSettingsActions();
  const actions = useMemo(
    (): SettingsActions => ({
      ...settingsActions,
      removeProject: (data) => removeWorkspaceTrackerProject({ data }),
    }),
    [settingsActions],
  );
  return (
    <ScreenMessages messages={settingsMessages}>
      <ProjectDetailScreen
        page={page}
        connectionId={connectionId}
        projectId={projectId}
        ws={ws}
        actions={actions}
        renderLink={routerSettingsLink}
        onRemoved={() => {
          void router
            .invalidate({ filter: (match) => match.routeId === "/_app/settings" })
            .then(() => navigate({ to: "/settings" }));
        }}
      />
    </ScreenMessages>
  );
}
