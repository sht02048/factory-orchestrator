import * as stylex from "@stylexjs/stylex";
import {
  Button,
  CodeBlock,
  Dialog,
  DialogClose,
  Field,
  InfoTip,
  Input,
  ProblemCallout,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsStep,
  SettingsSteps,
  Text,
  VisuallyHidden,
  focusStyles,
  showToast,
  type SettingsStepState,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";
import {
  WEBHOOK_WAIT_POLL_LIMIT_MS,
  WEBHOOK_WAIT_POLL_MS,
  webhookReceiptKey,
} from "@ganger/app/settings/model";
import type {
  TrackerConnectionView,
  WebhookSetupView,
  WebhookStateView,
} from "@ganger/app/settings/model";
import { useTime } from "../format/time";
import {
  CLOUDFLARE_TUNNEL_GUIDE_URL,
  LINEAR_WEBHOOK_SETTINGS_URL,
  TAILSCALE_FUNNEL_GUIDE_URL,
} from "../onboarding/model";
import { browserClipboard, copyText } from "./clipboard";
import { CredentialFormFrame, ExternalLink, SecretField } from "./credential-forms";
import { useInlineEdit } from "./row-state";
import { ChangeButton, FocusFirst } from "./settings-page";
import { SubmitError, useReportUnsaved, useSubmit, type SettingsActions } from "./settings-screen";

export const WEBHOOK_SECTION_ID = "webhook";

export interface WebhookSectionProps {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
  setup: WebhookSetupView;
  now: string;
  actions: SettingsActions;
}

function focusById(id: string): void {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export function webhookUrl(address: string | null, path: string): string | null {
  return address === null ? null : `${address}${path}`;
}

export function WebhookSection({
  connection,
  webhookAddress,
  setup,
  now,
  actions,
}: WebhookSectionProps) {
  const t = useTranslations("settings.webhook");
  const ts = useTranslations("settings");
  const state = connection.webhook;
  useWebhookWaitPolling(connection.id, state, actions.pollWebhookState);
  return (
    <SettingsSection
      id={WEBHOOK_SECTION_ID}
      title={t("title")}
      info={<InfoTip label={ts("infoLabel", { label: t("infoLabel") })} content={t("info")} />}
      detail={t(`status.${state.kind}`)}
      detailTone={state.kind === "rejected" ? "problem" : "default"}
    >
      {state.kind === "off" ? (
        <WebhookSteps
          connection={connection}
          webhookAddress={webhookAddress}
          setup={setup}
          actions={actions}
        />
      ) : (
        <WebhookOn
          connection={connection}
          state={state}
          webhookAddress={webhookAddress}
          setup={setup}
          now={now}
          actions={actions}
        />
      )}
    </SettingsSection>
  );
}

export function useWebhookWaitPolling(
  id: string,
  state: WebhookStateView,
  poll: (input: { id: string; key: string }) => Promise<boolean>,
): void {
  const waiting = state.kind === "waiting" || state.kind === "rejected";
  const key = webhookReceiptKey(state);
  useEffect(() => {
    if (!waiting) return undefined;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      timer = setTimeout(() => {
        if (stopped || Date.now() - started > WEBHOOK_WAIT_POLL_LIMIT_MS) return;
        poll({ id, key }).then(
          (same) => {
            if (same && !stopped) next();
          },
          () => {
            if (!stopped) next();
          },
        );
      }, WEBHOOK_WAIT_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id, key, waiting, poll]);
}

const STEP_IDS = { address: "webhook-step-address", create: "webhook-step-create" } as const;

function WebhookSteps({
  connection,
  webhookAddress,
  setup,
  actions,
}: {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
  setup: WebhookSetupView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.webhook");
  const edit = useInlineEdit("webhook-address");
  const createCopyRef = useRef<HTMLButtonElement>(null);
  const [focusCreate, setFocusCreate] = useState(false);
  const addressDone = webhookAddress !== null && !edit.open;
  const url = webhookUrl(webhookAddress, connection.webhookPath);
  useEffect(() => {
    if (!focusCreate || !addressDone) return;
    createCopyRef.current?.focus();
    setFocusCreate(false);
  }, [focusCreate, addressDone]);
  const stateLabel = (state: SettingsStepState) =>
    t(`stepState.${state === "open" ? "current" : state}`);
  const addressState: SettingsStepState = addressDone ? "done" : "current";
  const laterState: SettingsStepState = addressDone ? "open" : "locked";
  const createState: SettingsStepState = addressDone ? "current" : "locked";
  return (
    <SettingsSteps label={t("steps")}>
      <SettingsStep
        id={STEP_IDS.address}
        number={1}
        state={addressState}
        stateLabel={stateLabel(addressState)}
        label={t("address.label")}
        info={<AddressInfo />}
        detail={addressDone ? <VerifiedAddress address={webhookAddress} /> : undefined}
        control={addressDone ? <ChangeButton edit={edit} label={t("address.label")} /> : undefined}
      >
        {addressDone ? null : edit.open ? (
          <FocusFirst>
            <AddressEditor
              initial={webhookAddress ?? setup.funnel?.address ?? ""}
              setup={setup}
              actions={actions}
              onClose={edit.close}
              onSaved={() => {
                edit.close();
                setFocusCreate(true);
              }}
            />
          </FocusFirst>
        ) : (
          <AddressEditor
            initial={webhookAddress ?? setup.funnel?.address ?? ""}
            setup={setup}
            actions={actions}
            onClose={undefined}
            onSaved={() => setFocusCreate(true)}
          />
        )}
      </SettingsStep>
      <SettingsStep
        id={STEP_IDS.create}
        number={2}
        state={createState}
        stateLabel={stateLabel(createState)}
        label={t("create.label")}
      >
        {url === null ? null : (
          <>
            <CopyValue
              ref={createCopyRef}
              label={t("create.urlLabel")}
              value={url}
              copied={t("copiedUrl")}
            />
            <Text variant="meta" as="p">
              {t("create.events")}
            </Text>
            <span>
              <ExternalLink href={connection.webhookSettingsUrl ?? LINEAR_WEBHOOK_SETTINGS_URL}>
                {t("create.open")}
              </ExternalLink>
            </span>
          </>
        )}
      </SettingsStep>
      <SettingsStep
        number={3}
        state={laterState}
        stateLabel={stateLabel(laterState)}
        label={t("secret.label")}
      >
        <SecretForm
          connection={connection}
          actions={actions}
          success={t("secret.turnedOn")}
          primaryLabel={t("secret.turnOn")}
          onDone={() => focusById(WAITING_ID)}
        />
      </SettingsStep>
    </SettingsSteps>
  );
}

function AddressInfo() {
  const t = useTranslations("settings.webhook");
  const ts = useTranslations("settings");
  return (
    <InfoTip label={ts("infoLabel", { label: t("address.label") })} content={t("address.info")} />
  );
}

function VerifiedAddress({ address }: { address: string | null }) {
  const t = useTranslations("settings.webhook");
  return (
    <>
      <Text variant="meta" mono wrap="anywhere">
        {address}
      </Text>
      {" · "}
      {t("address.verified")}
    </>
  );
}

function CopyValue({
  label,
  value,
  copied,
  ref,
}: {
  label: string;
  value: string;
  copied: string;
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("settings.webhook");
  const copy = () => {
    void copyText(value, browserClipboard()).then((done) =>
      showToast(done ? copied : t("copyFailed")),
    );
  };
  return (
    <div {...stylex.props(styles.copy)}>
      <Text variant="meta">{label}</Text>
      <CodeBlock tone="command" label={label}>
        {value}
      </CodeBlock>
      <span>
        <Button
          {...(ref === undefined ? {} : { ref })}
          aria-label={t("copyLabel", { label })}
          onClick={copy}
        >
          {t("copy")}
        </Button>
      </span>
    </div>
  );
}

function FunnelGuide({ command }: { command: string }) {
  const t = useTranslations("settings.webhook.address");
  const tw = useTranslations("settings.webhook");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.funnel)}>
      <span {...stylex.props(styles.funnelHead)}>
        <Text variant="ui" tone="strong" id={titleId}>
          {t("funnelTitle")}
        </Text>
        <Text variant="meta">{t("funnelFound")}</Text>
      </span>
      <Text variant="meta" as="p">
        {t("funnelFirst")}{" "}
        <ExternalLink href={TAILSCALE_FUNNEL_GUIDE_URL}>{t("funnelFirstLink")}</ExternalLink>
      </Text>
      <Text variant="meta" as="p">
        {t("funnelRun")}
      </Text>
      <CopyValue label={t("commandLabel")} value={command} copied={tw("copiedCommand")} />
      <Text variant="meta" as="p">
        {t("funnelThen")}
      </Text>
    </section>
  );
}

const ADDRESS_ERRORS = [
  "invalid-address",
  "name-not-found",
  "unreachable",
  "other-server",
  "check-failed",
] as const;

function AddressEditor({
  initial,
  setup,
  actions,
  onClose,
  onSaved,
}: {
  initial: string;
  setup: WebhookSetupView;
  actions: SettingsActions;
  onClose: (() => void) | undefined;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.webhook.address");
  const ts = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState<(typeof ADDRESS_ERRORS)[number] | null>(null);
  const [tried, setTried] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = useSubmit();
  useReportUnsaved(onClose !== undefined && value !== initial);
  const reason = submit.state.kind === "failed" ? submit.state.reason : null;
  const failedState = submit.state.kind === "failed" ? submit.state : null;
  useEffect(() => {
    if (failedState === null) return;
    const knownReason = ADDRESS_ERRORS.find((known) => known === failedState.reason) ?? null;
    setFailed(knownReason);
    if (knownReason !== null) inputRef.current?.focus();
  }, [failedState]);
  const known = reason !== null && failed !== null;
  return (
    <>
      <Text variant="meta" as="p">
        {t("description")}
      </Text>
      {setup.funnel === null ? null : <FunnelGuide command={setup.funnel.command} />}
      <CredentialFormFrame
        onClose={onClose}
        onSubmit={() => {
          setTried(true);
          submit.run(
            () => actions.checkWebhookAddress({ address: value.trim() }),
            t("saved"),
            onSaved,
          );
        }}
        footer={
          <>
            <ExternalLink href={CLOUDFLARE_TUNNEL_GUIDE_URL}>{t("otherWays")}</ExternalLink>
            <InfoTip
              label={ts("infoLabel", { label: t("reverseProxy") })}
              content={t("reverseProxyInfo")}
            />
          </>
        }
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("checking") : tried ? t("recheck") : t("check")}
          </Button>
        }
      >
        <Field
          label={t("field")}
          error={known && !submit.sending ? t(`error.${failed}`) : undefined}
        >
          <Input
            ref={inputRef}
            name="webhookAddress"
            type="url"
            value={value}
            onValueChange={setValue}
            placeholder={t("placeholder")}
            autoComplete="off"
            mono
          />
        </Field>
        {known ? null : <SubmitError state={submit.state} />}
      </CredentialFormFrame>
    </>
  );
}

function SecretForm({
  connection,
  actions,
  success,
  primaryLabel,
  onClose,
  onDone,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
  success: string;
  primaryLabel: string;
  onClose?: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("settings.webhook.secret");
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [secret, setSecret] = useState("");
  const [missing, setMissing] = useState(false);
  useReportUnsaved(secret !== "");
  const submit = useSubmit();
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={null}
      onSubmit={() => {
        const ready = secret.trim() !== "";
        setMissing(!ready);
        if (!ready) {
          fieldsRef.current?.querySelector("input")?.focus();
          return;
        }
        submit.run(
          () =>
            actions.saveConnection({
              id: connection.id,
              apiKey: "",
              webhookSecret: secret.trim(),
            }),
          success,
          () => {
            setSecret("");
            onDone();
          },
        );
      }}
      submit={
        <Button variant="primary" type="submit" disabled={submit.sending}>
          {submit.sending ? t("turningOn") : primaryLabel}
        </Button>
      }
    >
      <div ref={fieldsRef} {...stylex.props(styles.fields)}>
        <SecretField
          name="webhookSecret"
          label={t("field")}
          hint={t("info")}
          hints="info"
          error={missing ? t("required") : undefined}
          placeholder={t("placeholder")}
          value={secret}
          onValueChange={(value) => {
            setSecret(value);
            if (missing) setMissing(value.trim() === "");
          }}
        />
      </div>
      <SubmitError state={submit.state} />
    </CredentialFormFrame>
  );
}

const WAITING_ID = "webhook-waiting";

function WebhookOn({
  connection,
  state,
  webhookAddress,
  setup,
  now,
  actions,
}: {
  connection: TrackerConnectionView;
  state: Exclude<WebhookStateView, { kind: "off" }>;
  webhookAddress: string | null;
  setup: WebhookSetupView;
  now: string;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.webhook");
  const time = useTime();
  const secretEdit = useInlineEdit("webhook-secret");
  const addressEdit = useInlineEdit("webhook-address");
  const url = webhookUrl(webhookAddress, connection.webhookPath);
  const last =
    state.kind === "receiving"
      ? time.ago(state.lastReceivedAt, state.lastReceivedAgoMs)
      : state.kind === "rejected" &&
          state.lastReceivedAt !== null &&
          state.lastReceivedAgoMs !== null
        ? time.ago(state.lastReceivedAt, state.lastReceivedAgoMs)
        : null;
  return (
    <div {...stylex.props(styles.on)}>
      {state.kind === "rejected" ? (
        <ProblemCallout
          title={t("rejected.title", { count: state.rejectedCount })}
          actions={
            secretEdit.open ? undefined : (
              <Button onClick={secretEdit.show}>{t("rejected.reenter")}</Button>
            )
          }
        >
          {t("rejected.body", { since: time.stamp(state.firstRejectedAt, now) })}
        </ProblemCallout>
      ) : null}
      <SettingsGroup>
        {state.kind === "waiting" ? (
          <div id={WAITING_ID} tabIndex={-1} role="status" {...stylex.props(focusStyles.target)}>
            <SettingsRow label={t("waiting.title")} detail={t("waiting.detail")} />
          </div>
        ) : (
          <SettingsRow label={t("lastReceived")} value={last ?? t("lastReceivedNone")} />
        )}
        {webhookAddress === null ? (
          <SettingsRow
            label={t("address.label")}
            info={<AddressInfo />}
            detail={addressEdit.open ? undefined : t("address.notSet")}
            detailTone="problem"
            control={
              addressEdit.open ? undefined : (
                <ChangeButton
                  edit={addressEdit}
                  label={t("address.label")}
                  action={t("address.set")}
                />
              )
            }
            expanded={
              addressEdit.open ? (
                <FocusFirst>
                  <AddressEditor
                    initial={setup.funnel?.address ?? ""}
                    setup={setup}
                    actions={actions}
                    onClose={addressEdit.close}
                    onSaved={addressEdit.close}
                  />
                </FocusFirst>
              ) : null
            }
          />
        ) : null}
        <SettingsRow
          label={t("url")}
          detail={url ?? t("urlMissing")}
          detailMono={url !== null}
          control={
            url === null ? undefined : (
              <CopyButton label={t("url")} value={url} copied={t("copiedUrl")} />
            )
          }
        />
        <SettingsRow
          label={t("secretRow")}
          detail={secretEdit.open ? undefined : t("secretSet")}
          control={
            secretEdit.open ? undefined : (
              <ChangeButton edit={secretEdit} label={t("secretRow")} action={t("secret.reenter")} />
            )
          }
          expanded={
            secretEdit.open ? (
              <FocusFirst>
                <SecretForm
                  connection={connection}
                  actions={actions}
                  success={t("secretSaved")}
                  primaryLabel={t("secret.save")}
                  onClose={secretEdit.close}
                  onDone={() => focusById(WAITING_ID)}
                />
              </FocusFirst>
            ) : null
          }
        />
        <TurnOffRow connection={connection} actions={actions} />
      </SettingsGroup>
    </div>
  );
}

function CopyButton({ label, value, copied }: { label: string; value: string; copied: string }) {
  const t = useTranslations("settings.webhook");
  return (
    <Button
      aria-label={t("copyLabel", { label })}
      onClick={() => {
        void copyText(value, browserClipboard()).then((done) =>
          showToast(done ? copied : t("copyFailed")),
        );
      }}
    >
      {t("copy")}
    </Button>
  );
}

function TurnOffRow({
  connection,
  actions,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.webhook.off");
  const submit = useSubmit();
  return (
    <SettingsRow
      label={t("label")}
      detail={t("detail")}
      message={<SubmitError state={submit.state} />}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>{t("trigger")}</VisuallyHidden>
              <span aria-hidden="true">{t("button")}</span>
            </>
          }
          triggerVariant="danger"
          title={t("confirmTitle")}
          description={t("confirmBody")}
          actions={
            <>
              <DialogClose>{t("cancel")}</DialogClose>
              <DialogClose
                variant="danger"
                onClick={() =>
                  submit.run(
                    () => actions.turnOffWebhook({ id: connection.id }),
                    t("done"),
                    () => focusById(`${WEBHOOK_SECTION_ID}-heading`),
                  )
                }
              >
                {t("confirm")}
              </DialogClose>
            </>
          }
        />
      }
    />
  );
}

const styles = stylex.create({
  copy: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  funnel: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  funnelHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2 },
  on: { display: "flex", flexDirection: "column", gap: space.s3 },
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
});
