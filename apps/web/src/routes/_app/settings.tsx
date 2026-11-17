import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import {
  addWorkspaceTrackerProject,
  checkGitHubTokenNow,
  checkTrackerConnectionNow,
  getSettingsPage,
  removeWorkspaceTrackerProject,
  requestRunnerCheckNow,
  saveGitHubTokenSetting,
  saveRunnerSettings,
  saveTrackerConnection,
  saveWorkspaceGeneral,
  saveWorkspaceInProgressState,
  saveWorkspaceLabel,
  saveWorkspaceMapping,
} from "../../server/settings-functions";
import { settingsMessages } from "../../settings/messages";
import { SettingsScreen } from "../../settings/settings-screen";
import type { ActionResult, SettingsActions } from "../../settings/settings-screen";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

/**
 * Settings: 이 Workspace(현재 ws) / 설치 전체(ADR 0006·0007). 고른 항목(sel)은 주소에 남는다.
 * 저장하면 화면 값을 다시 읽는다. 셸(Workspace 이름, 러너 목록)도 바뀔 수 있어 라우터 전체를 다시 읽는다.
 */
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
  const router = useRouter();

  const actions = useMemo((): SettingsActions => {
    /** 저장한 뒤 성공이면 다시 읽는다 */
    const then =
      <I,>(call: (input: I) => Promise<ActionResult>) =>
      async (input: I): Promise<ActionResult> => {
        const result = await call(input);
        if (result.ok) await router.invalidate();
        return result;
      };
    return {
      saveGeneral: then((data) => saveWorkspaceGeneral({ data })),
      addProject: then((data) => addWorkspaceTrackerProject({ data })),
      removeProject: then((data) => removeWorkspaceTrackerProject({ data })),
      saveMapping: then((data) => saveWorkspaceMapping({ data })),
      saveInProgress: then((data) => saveWorkspaceInProgressState({ data })),
      saveLabel: then((data) => saveWorkspaceLabel({ data })),
      saveConnection: then((data) => saveTrackerConnection({ data })),
      checkConnection: (data) => checkTrackerConnectionNow({ data }),
      saveGitHubToken: then((data) => saveGitHubTokenSetting({ data })),
      checkGitHubToken: () => checkGitHubTokenNow(),
      saveRunner: then((data) => saveRunnerSettings({ data })),
      recheckRunner: then((data) => requestRunnerCheckNow({ data })),
      refresh: () => router.invalidate(),
    };
  }, [router]);

  return (
    <ScreenMessages messages={settingsMessages}>
      <SettingsScreen
        page={page}
        selected={sel}
        onSelect={(item) => {
          void navigate({ search: (prev) => ({ ...prev, sel: item }), replace: true });
        }}
        actions={actions}
      />
    </ScreenMessages>
  );
}
