import * as stylex from "@stylexjs/stylex";
import {
  Button,
  ExternalIcon,
  Field,
  Input,
  VisuallyHidden,
  buttonStyles,
  linkStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { TrackerConnectionView } from "@ganger/app/settings/model";
import {
  SubmitError,
  passwordManagerIgnoredSecretProps,
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

export function TrackerKeyForm({
  connection,
  actions,
  primary = connection === null,
  onDone,
  onClose,
  guide,
  footer,
}: {
  connection: TrackerConnectionView | null;
  actions: SettingsActions;
  primary?: boolean;
  onDone?: () => void;
  onClose?: () => void;
  guide?: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("settings");
  const [apiKey, setApiKey] = useState("");
  const submit = useSubmit();
  const isNew = connection === null;
  const ready = apiKey.trim() !== "";
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={footer}
      onSubmit={() => {
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
        <Button
          variant={primary ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? t("connections.checking") : t("credentials.keyCheck")}
        </Button>
      }
    >
      <Field
        label={t("connections.apiKey")}
        description={isNew ? t("credentials.keyDescription") : t("credentials.keyDescriptionEdit")}
      >
        <Input
          name="apiKey"
          {...passwordManagerIgnoredSecretProps}
          value={apiKey}
          onValueChange={setApiKey}
          placeholder={t("credentials.keyPlaceholder")}
          mono
        />
      </Field>
      {guide}
      <SubmitError state={submit.state} />
    </CredentialFormFrame>
  );
}

export function GitHubTokenForm({
  actions,
  primary,
  onDone,
  onClose,
  footer,
}: {
  actions: SettingsActions;
  primary: boolean;
  onDone?: () => void;
  onClose?: () => void;
  footer?: ReactNode;
}) {
  const t = useTranslations("settings");
  const [token, setToken] = useState("");
  const submit = useSubmit();
  const ready = token.trim() !== "";
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={footer}
      onSubmit={() => {
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
        <Button
          variant={primary ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? t("saving") : t("github.save")}
        </Button>
      }
    >
      <Field label={t("github.token")} description={t("credentials.tokenDescription")}>
        <Input
          name="token"
          {...passwordManagerIgnoredSecretProps}
          value={token}
          onValueChange={setToken}
          placeholder={t("credentials.tokenPlaceholder")}
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
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
