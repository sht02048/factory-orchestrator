import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../i18n";
import { onboardingMessages } from "../onboarding/messages";
import { HOME_PATH, resolveStep } from "../onboarding/model";
import { OnboardingScreen } from "../onboarding/onboarding-screen";
import type { OnboardingActions } from "../onboarding/onboarding-screen";
import { createWorkspace } from "../server/onboarding-functions";
import { getSettingsPage } from "../server/settings-functions";
import { useReloadOnSuccess, useSettingsActions } from "../settings/use-settings-actions";

const t = createTranslator({
  locale: defaultLocale,
  messages: onboardingMessages,
  namespace: "onboarding",
});

/**
 * 온보딩(0026): 첫 진입 전용 전체 화면이라 사이드바가 있는 _app 밖에 둔다(ADR 0007).
 * 화면 값과 저장은 Settings 의 server function 을 그대로 쓴다. 보는 단계(step, 1부터)는 주소에 남는다.
 * Workspace 는 첫 Workspace 다(ws 를 주지 않는다).
 */
export const Route = createFileRoute("/onboarding")({
  validateSearch: z.object({ step: z.number().int().optional().catch(undefined) }),
  loader: () => getSettingsPage({ data: {} }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const page = Route.useLoaderData();
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();
  const settingsActions = useSettingsActions();
  const then = useReloadOnSuccess();
  const actions = useMemo(
    (): OnboardingActions => ({
      ...settingsActions,
      createWorkspace: then((data) => createWorkspace({ data })),
    }),
    [settingsActions, then],
  );

  return (
    <ScreenMessages messages={onboardingMessages}>
      <OnboardingScreen
        page={page}
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
