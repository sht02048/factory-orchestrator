import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Field, Text, Textarea, TextLink } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { HumanCheckDecision } from "@ganger/app/home/actions";
import { useState } from "react";
import { useTranslations } from "use-intl";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export type BodyPart = { kind: "text" | "link"; value: string };

export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  const addText = (value: string) => {
    if (value === "") return;
    const last = parts.at(-1);
    if (last?.kind === "text") last.value += value;
    else parts.push({ kind: "text", value });
  };
  let cursor = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    addText(body.slice(cursor, match.index));
    parts.push({ kind: "link", value: url });
    cursor = match.index + url.length;
  }
  addText(body.slice(cursor));
  return parts;
}

export function HumanCheckAnswer({
  body,
  onSend,
}: {
  body: string;
  onSend: (decision: HumanCheckDecision, note: string) => Promise<void>;
}) {
  const t = useTranslations("question.humanCheck");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<HumanCheckDecision | null>(null);
  const [failed, setFailed] = useState(false);
  const send = (decision: HumanCheckDecision) => {
    if (sending !== null) return;
    setSending(decision);
    setFailed(false);
    onSend(decision, note.trim()).then(
      () => setSending(null),
      () => {
        setSending(null);
        setFailed(true);
      },
    );
  };
  return (
    <div data-human-check {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.request)}>
        <Text variant="body" as="p" wrap="pre">
          {bodyParts(body).map((part, index) =>
            part.kind === "link" ? (
              <TextLink key={index} href={part.value} external>
                {part.value}
              </TextLink>
            ) : (
              part.value
            ),
          )}
        </Text>
      </div>
      <Field label={t("noteLabel")} description={t("noteHelp")}>
        <Textarea name="note" value={note} onValueChange={setNote} />
      </Field>
      <Actions>
        <Button
          variant="primary"
          disabled={sending !== null}
          onClick={() => {
            send("confirmed");
          }}
        >
          {sending === "confirmed" ? t("sending") : t("confirm")}
        </Button>
        <Button
          variant="secondary"
          disabled={sending !== null}
          onClick={() => {
            send("changes-requested");
          }}
        >
          {sending === "changes-requested" ? t("sending") : t("requestChanges")}
        </Button>
      </Actions>
      {failed ? (
        <Text variant="body" as="p" role="alert">
          {t("failed")}
        </Text>
      ) : (
        <Text variant="meta" as="p">
          {t("after")}
        </Text>
      )}
    </div>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  request: { overflowWrap: "anywhere" },
});
