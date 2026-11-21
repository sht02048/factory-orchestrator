import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Field, Text, Textarea, TextLink } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { HumanCheckDecision } from "@ganger/app/home/actions";
import { HUMAN_CHECK_NOTE_MAX, isHumanCheckNoteTooLong } from "@ganger/app/question";
import { useState } from "react";
import { useTranslations } from "use-intl";

const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%()]+/g;
const TRAILING_PUNCTUATION = ".,;:!?*";
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ")": "(", "]": "[" };

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

function withoutTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url.charAt(end - 1);
    const opening = CLOSING_BRACKETS[last];
    const kept = url.slice(0, end);
    const unmatched = opening !== undefined && countOf(kept, last) > countOf(kept, opening);
    if (!TRAILING_PUNCTUATION.includes(last) && !unmatched) break;
    end -= 1;
  }
  return url.slice(0, end);
}

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
    const url = withoutTrailingPunctuation(match[0]);
    addText(body.slice(cursor, match.index));
    parts.push({ kind: "link", value: url });
    cursor = match.index + url.length;
  }
  addText(body.slice(cursor));
  return parts;
}

export function HumanCheckRequest({ body }: { body: string }) {
  return (
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
  );
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
  const trimmed = note.trim();
  const tooLong = isHumanCheckNoteTooLong(trimmed);
  const blocked = sending !== null || tooLong;
  const send = (decision: HumanCheckDecision) => {
    if (blocked) return;
    setSending(decision);
    setFailed(false);
    onSend(decision, trimmed).then(
      () => setSending(null),
      () => {
        setSending(null);
        setFailed(true);
      },
    );
  };
  return (
    <div data-human-check {...stylex.props(styles.stack)}>
      <HumanCheckRequest body={body} />
      <Field
        label={t("noteLabel")}
        description={t("noteHelp")}
        error={tooLong ? t("noteTooLong", { max: HUMAN_CHECK_NOTE_MAX }) : undefined}
      >
        <Textarea name="note" value={note} onValueChange={setNote} />
      </Field>
      <Actions>
        <Button
          variant="primary"
          disabled={blocked}
          onClick={() => {
            send("confirmed");
          }}
        >
          {sending === "confirmed" ? t("sending") : t("confirm")}
        </Button>
        <Button
          variant="secondary"
          disabled={blocked}
          onClick={() => {
            send("changes-requested");
          }}
        >
          {sending === "changes-requested" ? t("sending") : t("requestChanges")}
        </Button>
      </Actions>
      {failed ? (
        <Text variant="ui" tone="problem" as="p" role="alert">
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
});
