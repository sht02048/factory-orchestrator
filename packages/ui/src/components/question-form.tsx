import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { AnswerDraft } from "./answer-draft";
import { answerToSend, emptyDraft, pickChoice, pickOther, writeOther } from "./answer-draft";
import { Button } from "./button";
import { Field, Textarea } from "./field";
import { RadioGroup, RadioOption } from "./radio";
import { textStyles } from "./text";
import { colors, fontWeight, space } from "../tokens.stylex";

export interface QuestionChoiceItem {
  marker: string | null;
  text: string;
  answer: string;
}

export interface QuestionFormLabels {
  other: string;
  otherLabel: string;
  otherPlaceholder: string;
  answerLabel: string;
  pick: string;
  empty: string;
  note: string;
  shortcut: string;
  send: string;
  sending: string;
  failed: string;
}

export interface QuestionFormProps {
  lead: ReadonlyArray<string>;
  choices: ReadonlyArray<QuestionChoiceItem>;
  after?: ReadonlyArray<string>;
  labels: QuestionFormLabels;
  onSend: (answer: string) => Promise<void>;
}

type SendState = "idle" | "sending" | "failed";

function pickOnEnter(pick: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    pick();
  };
}

export function QuestionForm({ lead, choices, after = [], labels, onSend }: QuestionFormProps) {
  const [draft, setDraft] = useState<AnswerDraft>(emptyDraft);
  const [state, setState] = useState<SendState>("idle");
  const [missing, setMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const name = useId();
  const leadId = useId();
  const hintId = useId();
  const problemId = useId();
  const free = choices.length === 0;
  const answers = choices.map((choice) => choice.answer);
  const answer = answerToSend(answers, free ? pickOther(draft) : draft);
  const sending = state === "sending";
  const otherPicked = draft.pick?.kind === "other";

  const writeAfterPick = useRef(false);

  useEffect(() => {
    if (!otherPicked) {
      writeAfterPick.current = false;
      return;
    }
    if (!writeAfterPick.current) return;
    writeAfterPick.current = false;
    otherRef.current?.focus();
  }, [otherPicked]);

  const change = (next: (draft: AnswerDraft) => AnswerDraft) => {
    setMissing(false);
    setDraft(next);
  };

  const pickOtherToWrite = () => {
    if (otherPicked) {
      otherRef.current?.focus();
      return;
    }
    writeAfterPick.current = true;
    change(pickOther);
  };

  const send = () => {
    if (sending) return;
    if (answer === null) {
      setMissing(true);
      formRef.current?.querySelector<HTMLElement>("textarea, input[type=radio]")?.focus();
      return;
    }
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
  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    send();
  };
  const writing = free || otherPicked;
  const hint = writing ? labels.shortcut : draft.pick === null ? labels.pick : labels.note;
  const problem =
    state === "failed" ? labels.failed : missing ? (writing ? labels.empty : labels.pick) : null;
  const describedBy = `${problemId} ${hintId}`;

  return (
    <form ref={formRef} onSubmit={onSubmit} data-question="" {...stylex.props(styles.form)}>
      <div id={leadId} {...stylex.props(styles.paragraphs)}>
        {lead.map((paragraph, index) => (
          <p key={index} {...stylex.props(textStyles("body"), styles.paragraph)}>
            {paragraph}
          </p>
        ))}
      </div>
      <fieldset disabled={sending} {...stylex.props(styles.fieldset)}>
        {free ? (
          <Field label={labels.answerLabel}>
            <Textarea
              name="answer"
              rows={3}
              value={draft.otherText}
              placeholder={labels.otherPlaceholder}
              aria-describedby={`${leadId} ${describedBy}`}
              onValueChange={(text) => change((d) => writeOther(d, text))}
              onKeyDown={onTextKeyDown}
            />
          </Field>
        ) : (
          <>
            <RadioGroup labelledBy={leadId}>
              {choices.map((choice, index) => (
                <RadioOption
                  key={`${index}:${choice.answer}`}
                  name={name}
                  value={String(index)}
                  checked={draft.pick?.kind === "choice" && draft.pick.index === index}
                  onCheck={() => change((d) => pickChoice(d, index))}
                  onKeyDown={pickOnEnter(() => change((d) => pickChoice(d, index)))}
                >
                  {choice.marker === null ? (
                    choice.text
                  ) : (
                    <span {...stylex.props(styles.marked)}>
                      <span {...stylex.props(styles.marker)}>{choice.marker}</span>{" "}
                      <span>{choice.text}</span>
                    </span>
                  )}
                </RadioOption>
              ))}
              <span
                onPointerDown={() => (writeAfterPick.current = true)}
                {...stylex.props(styles.contents)}
              >
                <RadioOption
                  name={name}
                  value="other"
                  checked={otherPicked}
                  onCheck={() => change(pickOther)}
                  onKeyDown={pickOnEnter(pickOtherToWrite)}
                >
                  {labels.other}
                </RadioOption>
              </span>
            </RadioGroup>
            {after.length === 0 ? null : (
              <div {...stylex.props(styles.paragraphs)}>
                {after.map((paragraph, index) => (
                  <p
                    key={index}
                    {...stylex.props(textStyles("ui"), styles.paragraph, styles.after)}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            )}
            {otherPicked ? (
              <Textarea
                ref={otherRef}
                name="answer"
                rows={3}
                value={draft.otherText}
                placeholder={labels.otherPlaceholder}
                aria-label={labels.otherLabel}
                aria-describedby={describedBy}
                onValueChange={(text) => change((d) => writeOther(d, text))}
                onKeyDown={onTextKeyDown}
              />
            ) : null}
          </>
        )}
      </fieldset>
      <p
        id={problemId}
        role="alert"
        {...stylex.props(textStyles("ui", "problem"), problem === null && styles.contents)}
      >
        {problem}
      </p>
      <div {...stylex.props(styles.foot)}>
        <span id={hintId} {...stylex.props(textStyles("label"))}>
          {hint}
        </span>
        <Button variant="primary" type="submit" disabled={sending}>
          {sending ? labels.sending : labels.send}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  paragraphs: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  paragraph: { margin: 0, whiteSpace: "pre-line", overflowWrap: "anywhere" },
  after: { color: colors.textSecondary },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  contents: { display: "contents" },
  marked: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: space.s2,
  },
  marker: {
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
  },
  foot: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
});
