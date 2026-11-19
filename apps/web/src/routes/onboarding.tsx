import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../i18n";
import { onboardingMessages } from "../onboarding/messages";
import { HOME_PATH, ONBOARDING_PATH, resolveStep, stepToPin } from "../onboarding/model";
import { OnboardingScreen } from "../onboarding/onboarding-screen";
import type { OnboardingActions } from "../onboarding/onboarding-screen";
import { getOnboardingPage, setUpWorkspace } from "../server/onboarding-functions";
import { runnerSetupMessages } from "../runner-setup/messages";
import { useRunnerSetupActions } from "../runner-setup/use-runner-setup-actions";
import { useReloadOnSuccess, useSettingsActions } from "../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: onboardingMessages,
  namespace: "onboarding",
});

export const Route = createFileRoute("/onboarding")({
  validateSearch: z.object({ step: z.number().int().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ step: search.step }),
  loader: async ({ deps }) => {
    const loaded = await getOnboardingPage({
      data: deps.step === undefined ? {} : { step: deps.step },
    });
    const pinned = stepToPin(loaded.page, deps.step);
    if (pinned !== null) {
      throw redirect({ to: ONBOARDING_PATH, search: { step: pinned }, replace: true });
    }
    return loaded;
  },
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const { page, trackerProjects } = Route.useLoaderData();
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();
  const settingsActions = useSettingsActions();
  const then = useReloadOnSuccess();
  const setupActions = useRunnerSetupActions();
  const actions = useMemo(
    (): OnboardingActions => ({
      ...settingsActions,
      ...setupActions,
      setUpWorkspace: then((data) => setUpWorkspace({ data })),
    }),
    [settingsActions, setupActions, then],
  );

  return (
    <ScreenMessages messages={{ ...onboardingMessages, ...runnerSetupMessages }}>
      <OnboardingScreen
        page={page}
        trackerProjects={trackerProjects}
        index={resolveStep(page, step)}
        onStep={(index) => {
          void navigate({ search: { step: index + 1 } });
        }}
        onFinish={() => {
          void navigate({ to: HOME_PATH });
        }}
        actions={actions}
      />
    </ScreenMessages>
  );
}
