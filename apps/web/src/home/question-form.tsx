import * as stylex from "@stylexjs/stylex";
import { Button } from "@factory/ui";
import { colors, fontSize, fontWeight, lineHeight, radius, space } from "@factory/ui/tokens.stylex";
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
  const otherId = useId();
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
        <legend {...stylex.props(styles.questionText)}>{question.body}</legend>
        <div {...stylex.props(styles.choices)}>
          {question.choices.map((choice, index) => (
            <label key={`${index}:${choice}`} {...stylex.props(styles.choice)}>
              <input
                type="radio"
                name={name}
                value={String(index)}
                checked={draft.pick?.kind === "choice" && draft.pick.index === index}
                onChange={() => setDraft((d) => pickChoice(d, index))}
                onKeyDown={pickOnEnter(() => setDraft((d) => pickChoice(d, index)))}
                {...stylex.props(styles.radio)}
              />
              <span {...stylex.props(styles.choiceText)}>{choice}</span>
            </label>
          ))}
          <label {...stylex.props(styles.choice)}>
            <input
              type="radio"
              name={name}
              value="other"
              checked={otherPicked}
              onChange={() => setDraft(pickOther)}
              onKeyDown={pickOnEnter(() => setDraft(pickOther))}
              {...stylex.props(styles.radio)}
            />
            <span {...stylex.props(styles.choiceText)}>{t("other")}</span>
          </label>
        </div>
        {otherPicked ? (
          <div {...stylex.props(styles.other)}>
            <label htmlFor={otherId} {...stylex.props(styles.srOnly)}>
              {t("otherLabel")}
            </label>
            <textarea
              ref={otherRef}
              id={otherId}
              name="answer"
              rows={3}
              value={draft.otherText}
              placeholder={t("otherPlaceholder")}
              aria-describedby={hintId}
              onChange={(event) => {
                const text = event.currentTarget.value;
                setDraft((d) => writeOther(d, text));
              }}
              onKeyDown={onOtherKeyDown}
              {...stylex.props(styles.textarea)}
            />
          </div>
        ) : null}
      </fieldset>
      {state === "failed" ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {t("failed")}
        </p>
      ) : null}
      <div {...stylex.props(styles.layerFoot)}>
        <span id={hintId} {...stylex.props(styles.hint)}>
          {draft.pick === null ? t("pick") : otherPicked ? t("shortcut") : t("note")}
        </span>
        <Button variant="primary" type="submit" disabled={answer === null || sending}>
          {sending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
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
  questionText: {
    margin: 0,
    padding: 0,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.normal,
    overflowWrap: "anywhere",
  },
  choices: { display: "flex", flexDirection: "column", gap: space.px2 },
  choice: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
      ":has(input:checked)": colors.bgSelected,
    },
    color: colors.textPrimary,
    cursor: "pointer",
  },
  radio: {
    flexShrink: 0,
    width: 16,
    height: 16,
    marginBlock: 2,
    marginInline: 0,
    accentColor: colors.accent,
  },
  choiceText: {
    minWidth: 0,
    lineHeight: lineHeight.normal,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  other: { display: "flex", flexDirection: "column", minWidth: 0 },
  textarea: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 72,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
    color: colors.textPrimary,
    font: "inherit",
    fontSize: { default: fontSize.body, "@media (pointer: coarse)": fontSize.input },
    lineHeight: lineHeight.normal,
    resize: "vertical",
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
  },
  error: { margin: 0, color: colors.problem, fontSize: fontSize.ui },
  layerFoot: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  hint: { minWidth: 0, color: colors.textTertiary, fontSize: fontSize.small },
});
