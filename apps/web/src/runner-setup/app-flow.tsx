import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  BulletList,
  Button,
  Card,
  Disclosure,
  NumberedList,
  PanelBlock,
  Text,
  VisuallyHidden,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { RefObject } from "react";
import { useTranslations } from "use-intl";
import type { StartAppEnrollmentResult } from "@ganger/app/runner-setup/enrollment";
import type { RunnerId } from "@ganger/core";
import {
  Registered,
  UnavailableNotice,
  WaitingRow,
  enrollmentStatus,
  remainingLabel,
  useEnrollment,
  useNow,
  useRegisteredFocus,
} from "./enrollment";
import type { EnrollmentActions } from "./enrollment";

export interface AppFlowActions extends EnrollmentActions {
  startAppEnrollment: (replacing?: string) => Promise<StartAppEnrollmentResult>;
}

const WHAT_ITEMS = ["remoteLogin", "key", "service", "github", "report"] as const;
const HELP_ITEMS = ["connected", "version", "command"] as const;

export function AppFlow({
  actions,
  titleRef,
  onBack,
  primary,
  onOpenRunner,
  onRegistered,
}: {
  actions: AppFlowActions;
  titleRef: RefObject<HTMLSpanElement | null>;
  onBack: () => void;
  primary: boolean;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onRegistered?: (runnerId: RunnerId) => void;
}) {
  const t = useTranslations("runnerSetup.app");
  const tc = useTranslations("runnerSetup.command");
  const { state, start, renewed } = useEnrollment(actions, actions.startAppEnrollment);
  const live =
    state.kind === "issued" && (state.view.state === "waiting" || state.view.state === "preparing");
  const now = useNow(live);
  const { left, expired, preparing, registered, failed } = enrollmentStatus(state, now);
  const openRunnerRef = useRegisteredFocus(registered, onRegistered);
  const askAgain = () => {
    titleRef.current?.focus();
    void start();
  };
  const stopped = expired || failed !== null;

  return (
    <Card label={t("title")} surface="plain">
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.group)}>
          <Text variant="title" as="h3">
            <span ref={titleRef} tabIndex={-1} {...stylex.props(focusStyles.ring)}>
              {t("title")}
            </span>
          </Text>
          {registered === null ? <Text variant="body">{t("body")}</Text> : null}
          <VisuallyHidden>
            <span role="alert">
              {state.kind === "unavailable" && state.reason !== "no-web-address"
                ? tc(`unavailable.${state.reason}`)
                : ""}
            </span>
          </VisuallyHidden>
        </div>
        {registered !== null ? (
          <Registered
            runner={registered}
            primary={primary}
            openRunnerRef={openRunnerRef}
            onBack={onBack}
            {...(onOpenRunner === undefined ? {} : { onOpenRunner })}
          />
        ) : state.kind === "unavailable" ? (
          <UnavailableNotice
            reason={state.reason}
            actions={actions}
            saveLabel={t("addressSave")}
            onRetry={askAgain}
          />
        ) : (
          <>
            <section aria-label={t("stepsLabel")}>
              <NumberedList
                items={[
                  <span key="remote" {...stylex.props(styles.group)}>
                    <Text variant="ui" tone="strong">
                      {tc("remoteLoginTitle")}
                    </Text>
                    <Text variant="meta">{tc("remoteLoginBody")}</Text>
                  </span>,
                  <span key="press" {...stylex.props(styles.group)}>
                    <Text variant="ui" tone="strong">
                      {t("pressTitle")}
                    </Text>
                    <Text variant="meta">{t("pressBody")}</Text>
                    {state.kind === "issued" && !stopped ? (
                      <Text variant="meta" numeric>
                        {t("expiresIn", { time: remainingLabel(left) })}
                      </Text>
                    ) : null}
                  </span>,
                ]}
              />
            </section>
            <WaitingRow
              message={
                failed !== null
                  ? t("failed", { problem: tc(`problem.${failed.problem}`) })
                  : expired
                    ? t("expired")
                    : preparing
                      ? t("preparing")
                      : state.kind === "issued"
                        ? renewed > 0
                          ? t("askedAgain")
                          : t("waiting")
                        : t("starting")
              }
              detail={failed?.detail ?? null}
              problem={failed !== null}
              retryLabel={stopped ? t("askAgain") : null}
              primary={primary}
              onRetry={askAgain}
            />
            <Disclosure summary={t("whatTitle")}>
              <BulletList items={WHAT_ITEMS.map((item) => tc(`what.${item}`))} />
              <Text variant="meta">{tc("whatNote")}</Text>
            </Disclosure>
            <PanelBlock title={t("helpTitle")}>
              <BulletList tone="tertiary" items={HELP_ITEMS.map((item) => t(`help.${item}`))} />
            </PanelBlock>
          </>
        )}
        {registered === null ? (
          <Actions>
            <Button onClick={onBack}>{tc("back")}</Button>
          </Actions>
        ) : null}
      </div>
    </Card>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
});
