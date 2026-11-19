import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  BulletList,
  Button,
  Card,
  CodeBlock,
  Disclosure,
  NumberedList,
  PanelBlock,
  SegmentedTabs,
  Text,
  TextLink,
  VisuallyHidden,
  focusStyles,
  showToast,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { RefObject } from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { StartEnrollmentResult } from "@ganger/app/runner-setup/enrollment";
import type { RunnerId } from "@ganger/core";
import { browserClipboard, copyText } from "../settings/clipboard";
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

export interface CommandFlowActions extends EnrollmentActions {
  startEnrollment: (replacing?: string) => Promise<StartEnrollmentResult>;
}

const WHAT_ITEMS = ["remoteLogin", "key", "service", "github", "report"] as const;
const HELP_ITEMS = ["unreachable", "orca", "other"] as const;

type Issued = Extract<StartEnrollmentResult, { ok: true }>;

export function CommandFlow({
  actions,
  titleRef,
  onBack,
  primary,
  onOpenRunner,
  onRegistered,
}: {
  actions: CommandFlowActions;
  titleRef: RefObject<HTMLSpanElement | null>;
  onBack: () => void;
  primary: boolean;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onRegistered?: (runnerId: RunnerId) => void;
}) {
  const t = useTranslations("runnerSetup.command");
  const tp = useTranslations("runnerSetup.command.problem");
  const { state, start, renewed } = useEnrollment(actions, actions.startEnrollment);
  const waiting = state.kind === "issued" && state.view.state === "waiting";
  const now = useNow(waiting);
  const { left, expired, registered, failed } = enrollmentStatus(state, now);
  const openRunnerRef = useRegisteredFocus(registered, onRegistered);
  const newCommand = () => {
    titleRef.current?.focus();
    void start();
  };

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
                ? t(`unavailable.${state.reason}`)
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
            saveLabel={t("address.save")}
            onRetry={newCommand}
          />
        ) : (
          <>
            <Steps
              issued={state.kind === "issued" ? state.issued : null}
              stopped={expired || failed !== null}
              left={left}
            />
            <WaitingRow
              message={
                failed !== null
                  ? t("failed", { problem: tp(failed.problem) })
                  : expired
                    ? t("expired")
                    : state.kind === "issued"
                      ? renewed > 0
                        ? t("newCommandReady")
                        : t("waiting")
                      : ""
              }
              detail={failed?.detail ?? null}
              problem={failed !== null}
              retryLabel={expired || failed !== null ? t("newCommand") : null}
              primary={primary}
              onRetry={newCommand}
            />
            <Disclosure summary={t("whatTitle")}>
              <BulletList items={WHAT_ITEMS.map((item) => t(`what.${item}`))} />
              <Text variant="meta">{t("whatNote")}</Text>
            </Disclosure>
            <PanelBlock title={t("helpTitle")}>
              <BulletList tone="tertiary" items={HELP_ITEMS.map((item) => t(`help.${item}`))} />
            </PanelBlock>
          </>
        )}
        {registered === null ? (
          <Actions>
            <Button onClick={onBack}>{t("back")}</Button>
          </Actions>
        ) : null}
      </div>
    </Card>
  );
}

function Steps({
  issued,
  stopped,
  left,
}: {
  issued: Issued | null;
  stopped: boolean;
  left: number;
}) {
  const t = useTranslations("runnerSetup.command");
  return (
    <section aria-label={t("stepsLabel")} {...stylex.props(styles.stack)}>
      <NumberedList
        items={[
          <span key="remote" {...stylex.props(styles.stepBody)}>
            <Text variant="ui" tone="strong">
              {t("remoteLoginTitle")}
            </Text>
            <Text variant="meta">{t("remoteLoginBody")}</Text>
          </span>,
          <span key="paste" {...stylex.props(styles.stepBody)}>
            <Text variant="ui" tone="strong">
              {t("pasteTitle")}
            </Text>
            {issued === null ? (
              <Text variant="meta" role="status">
                {t("starting")}
              </Text>
            ) : stopped ? (
              <Text variant="meta">{t("expiredHere")}</Text>
            ) : (
              <CommandBox issued={issued} left={left} />
            )}
          </span>,
        ]}
      />
    </section>
  );
}

type CommandForm = "oneLine" | "reviewFirst";

function CommandBox({ issued, left }: { issued: Issued; left: number }) {
  const t = useTranslations("runnerSetup.command");
  const [form, setForm] = useState<CommandForm>("oneLine");
  const command = form === "reviewFirst" ? issued.reviewCommand : issued.command;
  const copy = () => {
    void copyText(command, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied") : t("copyFailed")),
    );
  };
  return (
    <span {...stylex.props(styles.group)}>
      <SegmentedTabs<CommandForm>
        value={form}
        onValueChange={setForm}
        label={t("formLabel")}
        items={[
          { value: "oneLine", label: t("oneLine") },
          { value: "reviewFirst", label: t("reviewFirst") },
        ]}
      />
      <CodeBlock
        tone="command"
        label={form === "reviewFirst" ? t("reviewCommandLabel") : t("commandLabel")}
      >
        {command}
      </CodeBlock>
      <span {...stylex.props(styles.linkRow)}>
        <span {...stylex.props(styles.inline)}>
          <Button onClick={copy}>{t("copy")}</Button>
          <TextLink href={issued.scriptPath} external tone="action">
            {t("viewScript")}
          </TextLink>
        </span>
        <Text variant="meta" numeric>
          {t("expiresIn", { time: remainingLabel(left) })}
        </Text>
      </span>
    </span>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  stepBody: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  inline: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  linkRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
});
