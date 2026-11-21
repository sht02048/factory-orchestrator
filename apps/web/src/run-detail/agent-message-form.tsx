import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Card, Field, Text, Textarea } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { AGENT_MESSAGE_MAX_LENGTH } from "@ganger/core";
import type { AgentMessageDelivery, AgentMessageView } from "@ganger/app/run-detail/model";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "use-intl";

export type AgentMessageOutcome = "requested" | "state-changed";

type Submit = "idle" | "sending" | "state-changed" | "failed";

export function useDeliveryText(): (delivery: AgentMessageDelivery) => string {
  const t = useTranslations("run.agentMessage");
  return (delivery) => {
    switch (delivery.status) {
      case "failed":
        return delivery.reason === "outcome-unknown"
          ? t("failure.outcome-unknown")
          : t("delivery.failed", { reason: t(`failure.${delivery.reason}`) });
      case "sending":
      case "after-resume":
      case "after-reconnect":
      case "sent":
        return t(`delivery.${delivery.status}`);
    }
  };
}

export function AgentMessageForm({
  view,
  hint,
  onSend,
}: {
  view: AgentMessageView;
  hint: "paused" | "waiting" | null;
  onSend: (body: string) => Promise<AgentMessageOutcome>;
}) {
  const t = useTranslations("run.agentMessage");
  const actionFailed = useTranslations("run")("actionFailed");
  const deliveryText = useDeliveryText();
  const [draft, setDraft] = useState("");
  const [submit, setSubmit] = useState<Submit>("idle");
  const [sentHere, setSentHere] = useState(false);
  const [emptyTried, setEmptyTried] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rejectedRef = useRef<HTMLParagraphElement>(null);
  const rejectedAfterClose = !view.accepting && submit === "state-changed";
  useEffect(() => {
    if (rejectedAfterClose) rejectedRef.current?.focus();
  }, [rejectedAfterClose]);
  const body = draft.trim();
  const tooLong = body.length > AGENT_MESSAGE_MAX_LENGTH;
  const error = tooLong
    ? t("tooLong", { max: AGENT_MESSAGE_MAX_LENGTH })
    : emptyTried && body === ""
      ? t("empty")
      : undefined;

  const send = (event: FormEvent): void => {
    event.preventDefault();
    if (submit === "sending" || tooLong) return;
    if (body === "") {
      setEmptyTried(true);
      inputRef.current?.focus();
      return;
    }
    setSubmit("sending");
    onSend(body).then(
      (outcome) => {
        if (outcome === "requested") {
          setDraft("");
          setEmptyTried(false);
          setSentHere(true);
          setSubmit("idle");
        } else {
          setSubmit("state-changed");
        }
        inputRef.current?.focus();
      },
      () => {
        setSubmit("failed");
        inputRef.current?.focus();
      },
    );
  };

  if (rejectedAfterClose) {
    return (
      <Card label={t("title")}>
        <div {...stylex.props(styles.form)}>
          <Text variant="subheading" as="h2">
            {t("title")}
          </Text>
          <Text variant="body" as="p" tone="problem" role="status" tabIndex={-1} ref={rejectedRef}>
            {t("failure.state-changed")}
          </Text>
          <Text variant="meta" as="p">
            {t("unsentLabel")}
          </Text>
          <Text variant="body" as="p" wrap="pre">
            {draft}
          </Text>
        </div>
      </Card>
    );
  }
  if (!view.accepting) return null;

  const latest = view.latest;
  const result =
    submit === "sending"
      ? t("delivery.sending")
      : submit === "failed"
        ? actionFailed
        : submit === "state-changed"
          ? t("failure.state-changed")
          : latest === null || (latest.status === "sent" && !sentHere)
            ? ""
            : deliveryText(latest);
  const problem =
    submit === "failed" ||
    submit === "state-changed" ||
    (submit !== "sending" && latest?.status === "failed");

  return (
    <Card label={t("title")}>
      <form onSubmit={send} {...stylex.props(styles.form)}>
        <Text variant="subheading" as="h2">
          {t("title")}
        </Text>
        <Field
          label={t("label")}
          error={error}
          {...(hint === null ? {} : { description: t(`hint.${hint}`) })}
        >
          <Textarea
            ref={inputRef}
            name="agent-message"
            rows={3}
            value={draft}
            onValueChange={setDraft}
            placeholder={t("placeholder")}
          />
        </Field>
        <Actions>
          <Button
            type="submit"
            variant="secondary"
            aria-disabled={submit === "sending"}
            aria-busy={submit === "sending"}
          >
            {t("send")}
          </Button>
        </Actions>
        <Text
          variant="meta"
          as="p"
          role="status"
          {...(problem ? { tone: "problem" as const } : {})}
        >
          {result}
        </Text>
      </form>
    </Card>
  );
}

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
  },
});
