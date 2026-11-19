import * as stylex from "@stylexjs/stylex";
import {
  Button,
  ExternalIcon,
  Field,
  InfoTip,
  Input,
  VisuallyHidden,
  buttonStyles,
  linkStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { TrackerConnectionView } from "@ganger/app/settings/model";
import { EditorBlockedNotice } from "./row-state";
import {
  SubmitError,
  passwordManagerIgnoredSecretProps,
  useReportUnsaved,
  useSubmit,
  type SettingsActions,
} from "./settings-screen";

export function ExternalLink({
  href,
  children,
  button = false,
}: {
  href: string;
  children: ReactNode;
  button?: boolean;
}) {
  const t = useTranslations("settings");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      {...(button ? { "data-variant": "secondary" } : {})}
      {...stylex.props(...(button ? buttonStyles("secondary") : linkStyles("action")))}
    >
      {children}
      <ExternalIcon />
      <VisuallyHidden>{t("externalLink")}</VisuallyHidden>
    </a>
  );
}

export interface CredentialFormFrameProps {
  onSubmit: () => void;
  onClose: (() => void) | undefined;
  children: ReactNode;
  footer: ReactNode;
  submit: ReactNode;
}

export function CredentialFormFrame({
  onSubmit,
  onClose,
  children,
  footer,
  submit,
}: CredentialFormFrameProps) {
  const t = useTranslations("settings");
  const hasFooter = footer !== undefined && footer !== null;
  return (
    <form
      noValidate
      {...stylex.props(styles.form)}
      onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
        if (event.key === "Escape" && onClose !== undefined) {
          event.preventDefault();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {onClose === undefined ? null : <EditorBlockedNotice />}
      <div {...stylex.props(styles.actions)}>
        {hasFooter ? <span {...stylex.props(styles.footer)}>{footer}</span> : null}
        <span
          {...stylex.props(styles.buttons, (hasFooter || onClose !== undefined) && styles.pushEnd)}
        >
          {onClose === undefined ? null : (
            <Button variant="ghost" onClick={onClose}>
              {t("close")}
            </Button>
          )}
          {submit}
        </span>
      </div>
    </form>
  );
}

export type CredentialKind = "tracker" | "github";

export type HintPlacement = "description" | "info";

const CREDENTIAL_ERRORS = [
  "unauthorized",
  "rate-limited",
  "network",
  "not-found",
  "invalid",
] as const;

export function useCredentialReason(kind: CredentialKind): (reason: string) => string | null {
  const t = useTranslations("settings.credentials.error");
  return (reason) => {
    const known = CREDENTIAL_ERRORS.find((r) => r === reason);
    return known === undefined ? null : t(`${kind}.${known}`);
  };
}

function hintProps(
  hint: string,
  placement: HintPlacement,
  infoLabel: string,
): { description?: string; info?: ReactNode } {
  return placement === "info"
    ? { info: <InfoTip label={infoLabel} content={hint} /> }
    : { description: hint };
}

export function SecretField({
  name,
  label,
  hint,
  hints,
  error,
  placeholder,
  value,
  onValueChange,
}: {
  name: string;
  label: string;
  hint: string;
  hints: HintPlacement;
  error: string | undefined;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const t = useTranslations("settings");
  return (
    <Field label={label} error={error} {...hintProps(hint, hints, t("infoLabel", { label }))}>
      <Input
        name={name}
        {...passwordManagerIgnoredSecretProps}
        value={value}
        onValueChange={onValueChange}
        {...(placeholder === undefined ? {} : { placeholder })}
        mono
      />
    </Field>
  );
}

export function TrackerKeyForm({
  connection,
  actions,
  primary = connection === null,
  onDone,
  onClose,
  guide,
  footer,
  hints = "description",
}: {
  connection: TrackerConnectionView | null;
  actions: SettingsActions;
  primary?: boolean;
  onDone?: () => void;
  onClose?: () => void;
  guide?: ReactNode;
  footer?: ReactNode;
  hints?: HintPlacement;
}) {
  const t = useTranslations("settings");
  const describe = useCredentialReason("tracker");
  const [apiKey, setApiKey] = useState("");
  useReportUnsaved(apiKey !== "");
  const submit = useSubmit();
  const isNew = connection === null;
  const ready = apiKey.trim() !== "";
  const [missing, setMissing] = useState(false);
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={footer}
      onSubmit={() => {
        setMissing(!ready);
        if (!ready) return;
        submit.run(
          () =>
            actions.saveConnection({
              ...(connection === null ? {} : { id: connection.id }),
              apiKey: apiKey.trim(),
              webhookSecret: "",
            }),
          isNew ? t("connections.added") : t("saved"),
          () => {
            setApiKey("");
            onDone?.();
          },
        );
      }}
      submit={
        <Button variant={primary ? "primary" : "secondary"} type="submit" disabled={submit.sending}>
          {submit.sending ? t("connections.checking") : t("credentials.keyCheck")}
        </Button>
      }
    >
      <SecretField
        name="apiKey"
        label={t("connections.apiKey")}
        hint={isNew ? t("credentials.keyDescription") : t("credentials.keyDescriptionEdit")}
        hints={hints}
        error={missing ? t("credentials.keyRequired") : undefined}
        placeholder={t("credentials.keyPlaceholder")}
        value={apiKey}
        onValueChange={(value) => {
          setApiKey(value);
          if (missing) setMissing(value.trim() === "");
        }}
      />
      {guide}
      <SubmitError state={submit.state} describe={describe} />
    </CredentialFormFrame>
  );
}

export function GitHubTokenForm({
  actions,
  primary,
  onDone,
  onClose,
  footer,
  hints = "description",
}: {
  actions: SettingsActions;
  primary: boolean;
  onDone?: () => void;
  onClose?: () => void;
  footer?: ReactNode;
  hints?: HintPlacement;
}) {
  const t = useTranslations("settings");
  const describe = useCredentialReason("github");
  const [token, setToken] = useState("");
  useReportUnsaved(token !== "");
  const submit = useSubmit();
  const ready = token.trim() !== "";
  const [missing, setMissing] = useState(false);
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={footer}
      onSubmit={() => {
        setMissing(!ready);
        if (!ready) return;
        submit.run(
          () => actions.saveGitHubToken({ token: token.trim() }),
          t("saved"),
          () => {
            setToken("");
            onDone?.();
          },
        );
      }}
      submit={
        <Button variant={primary ? "primary" : "secondary"} type="submit" disabled={submit.sending}>
          {submit.sending ? t("saving") : t("github.save")}
        </Button>
      }
    >
      <SecretField
        name="token"
        label={t("github.token")}
        hint={t("credentials.tokenDescription")}
        hints={hints}
        error={missing ? t("credentials.tokenRequired") : undefined}
        placeholder={t("credentials.tokenPlaceholder")}
        value={token}
        onValueChange={(value) => {
          setToken(value);
          if (missing) setMissing(value.trim() === "");
        }}
      />
      <SubmitError state={submit.state} describe={describe} />
    </CredentialFormFrame>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space.s3,
    rowGap: space.s2,
  },
  footer: { display: "inline-flex", alignItems: "center", gap: space.s1, minWidth: 0 },
  buttons: { display: "flex", gap: space.s2 },
  pushEnd: { marginInlineStart: "auto" },
});
