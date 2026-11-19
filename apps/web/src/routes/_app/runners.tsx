import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runnersMessages } from "../../runners/messages";
import { RunnerSetup } from "../../runner-setup/runner-setup";
import { runnerSetupMessages } from "../../runner-setup/messages";
import { useRunnerSetupActions } from "../../runner-setup/use-runner-setup-actions";
import { RunnersScreen } from "../../runners/runners-screen";
import { settingsMessages } from "../../settings/messages";
import { RunnerForm } from "../../settings/settings-screen";
import { useSettingsActions } from "../../settings/use-settings-actions";
import type { RunnerActions } from "../../runners/runners-screen";
import { getRunnersPage } from "../../server/functions";
import { getRunnerChecksPending, requestRunnerCheckNow } from "../../server/settings-functions";

const t = createTranslator({
  locale: defaultLocale,
  messages: runnersMessages,
  namespace: "runners",
});

export function reloadOnEnter({ cause }: { cause: "preload" | "enter" | "stay" }): boolean {
  return cause === "enter";
}

export const Route = createFileRoute("/_app/runners")({
  validateSearch: z.object({ sel: z.string().optional() }),
  loader: () => getRunnersPage(),
  shouldReload: reloadOnEnter,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunnersRoute,
});

function RunnersRoute() {
  const page = Route.useLoaderData();
  const { sel, ws } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const actions = useMemo(
    (): RunnerActions => ({
      recheck: async (data) => {
        const result = await requestRunnerCheckNow({ data });
        if (result.ok) await router.invalidate();
        return result;
      },
      pollChecks: async () => {
        const pending = await getRunnerChecksPending();
        if (!pending) await router.invalidate();
        return pending;
      },
    }),
    [router],
  );
  const settingsActions = useSettingsActions();
  const setupActions = useRunnerSetupActions();
  const select = (id: string) => {
    void navigate({ search: (prev) => ({ ...prev, sel: id }), replace: true });
  };
  return (
    <ScreenMessages messages={{ ...runnersMessages, ...settingsMessages, ...runnerSetupMessages }}>
      <RunnersScreen
        page={page}
        selectedId={sel}
        ws={ws}
        onSelect={select}
        actions={actions}
        setup={
          <RunnerSetup
            actions={setupActions}
            manualForm={<RunnerForm runner={null} actions={settingsActions} primary={false} />}
            onOpenRunner={select}
            primary={false}
          />
        }
      />
    </ScreenMessages>
  );
}
