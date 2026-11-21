import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Card, Field, Text, Textarea } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { AGENT_MESSAGE_MAX_LENGTH } from "@ganger/core";
import type { AgentMessageDelivery, AgentMessageView } from "@ganger/app/run-detail/model";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "use-intl";

export type AgentMessageOutcome = "requested" | "state-changed";

export interface AgentMessageRequest {
  requestId: string;
  body: string;
}

function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  onSend: (input: AgentMessageRequest) => Promise<AgentMessageOutcome>;
}) {
  const t = useTranslations("run.agentMessage");
  const actionFailed = useTranslations("run")("actionFailed");
  const deliveryText = useDeliveryText();
  const [draft, setDraft] = useState("");
  const [submit, setSubmit] = useState<Submit>("idle");
  const [sentHere, setSentHere] = useState(false);
  const [emptyTried, setEmptyTried] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closedRef = useRef<HTMLParagraphElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const latest = view.latest;
  const unsent = submit === "failed" || submit === "state-changed" || draft.trim() !== "";
  const undelivered = sentHere && latest !== null && latest.status !== "sent";
  const closed = !view.accepting && submit !== "sending" && (unsent || undelivered);
  useEffect(() => {
    if (!closed) return;
    if (submit !== "idle" || document.activeElement === document.body) closedRef.current?.focus();
  }, [closed, submit]);
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
    requestIdRef.current ??= newRequestId();
    onSend({ requestId: requestIdRef.current, body }).then(
      (outcome) => {
        if (outcome === "requested") {
          requestIdRef.current = null;
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

  const edit = (value: string): void => {
    setDraft(value);
    requestIdRef.current = null;
    if (submit === "failed" || submit === "state-changed") setSubmit("idle");
  };

  if (closed) {
    const closedText =
      submit === "failed"
        ? actionFailed
        : unsent || latest === null
          ? t("failure.state-changed")
          : deliveryText(latest);
    const closedProblem = unsent || latest?.status === "failed";
    return (
      <Card label={t("title")}>
        <div {...stylex.props(styles.form)}>
          <Text variant="subheading" as="h2">
            {t("title")}
          </Text>
          <Text
            variant="body"
            as="p"
            role="status"
            tabIndex={-1}
            ref={closedRef}
            {...(closedProblem ? { tone: "problem" as const } : {})}
          >
            {closedText}
          </Text>
          {unsent ? (
            <>
              <Text variant="meta" as="p">
                {t("unsentLabel")}
              </Text>
              <Text variant="body" as="p" wrap="pre">
                {draft}
              </Text>
            </>
          ) : null}
        </div>
      </Card>
    );
  }
  if (!view.accepting && submit !== "sending") return null;

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
            onValueChange={edit}
            placeholder={t("placeholder")}
          />
        </Field>
        <Actions>
          <Button
            type="submit"
            variant="secondary"
            busy={{ active: submit === "sending", label: t("sending") }}
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
