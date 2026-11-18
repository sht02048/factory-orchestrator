import * as stylex from "@stylexjs/stylex";
import { Button, RadioGroup, RadioOption, Text, Textarea, textStyles } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslations } from "use-intl";
import type { AnswerDraft } from "./answer-draft";
import { answerToSend, emptyDraft, pickChoice, pickOther, writeOther } from "./answer-draft";
import type { InputWait } from "./model";

export type Question = Extract<InputWait, { kind: "question" }>;

export type SendState = "idle" | "sending" | "failed";

function pickOnEnter(pick: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    pick();
  };
}

export function QuestionForm({
  question,
  onSend,
}: {
  question: Question;
  onSend: (answer: string) => Promise<void>;
}) {
  const t = useTranslations("home.question");
  const [draft, setDraft] = useState<AnswerDraft>(emptyDraft);
  const [state, setState] = useState<SendState>("idle");
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const name = useId();
  const hintId = useId();
  const answer = answerToSend(question.choices, draft);
  const sending = state === "sending";
  const otherPicked = draft.pick?.kind === "other";

  useEffect(() => {
    if (otherPicked) otherRef.current?.focus();
  }, [otherPicked]);

  const send = () => {
    if (answer === null || sending) return;
    setState("sending");
    onSend(answer).then(
      () => setState("idle"),
      () => setState("failed"),
    );
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };
  const onOtherKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    send();
  };

  return (
    <form onSubmit={onSubmit} {...stylex.props(styles.layerForm)}>
      <fieldset disabled={sending} {...stylex.props(styles.fieldset)}>
        <legend {...stylex.props(textStyles("subheading"), styles.questionText)}>
          {question.body}
        </legend>
        <RadioGroup>
          {question.choices.map((choice, index) => (
            <RadioOption
              key={`${index}:${choice}`}
              name={name}
              value={String(index)}
              checked={draft.pick?.kind === "choice" && draft.pick.index === index}
              onCheck={() => setDraft((d) => pickChoice(d, index))}
              onKeyDown={pickOnEnter(() => setDraft((d) => pickChoice(d, index)))}
            >
              {choice}
            </RadioOption>
          ))}
          <RadioOption
            name={name}
            value="other"
            checked={otherPicked}
            onCheck={() => setDraft(pickOther)}
            onKeyDown={pickOnEnter(() => setDraft(pickOther))}
          >
            {t("other")}
          </RadioOption>
        </RadioGroup>
        {otherPicked ? (
          <Textarea
            ref={otherRef}
            name="answer"
            rows={3}
            value={draft.otherText}
            placeholder={t("otherPlaceholder")}
            aria-label={t("otherLabel")}
            aria-describedby={hintId}
            onValueChange={(text) => setDraft((d) => writeOther(d, text))}
            onKeyDown={onOtherKeyDown}
          />
        ) : null}
      </fieldset>
      {state === "failed" ? (
        <Text variant="ui" as="p" tone="problem" role="alert">
          {t("failed")}
        </Text>
      ) : null}
      <div {...stylex.props(styles.layerFoot)}>
        <Text variant="label" id={hintId}>
          {draft.pick === null ? t("pick") : otherPicked ? t("shortcut") : t("note")}
        </Text>
        <Button variant="primary" type="submit" disabled={answer === null || sending}>
          {sending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  layerForm: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  questionText: { padding: 0, overflowWrap: "anywhere" },
  layerFoot: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
});
