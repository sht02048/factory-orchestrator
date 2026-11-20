import { QuestionForm } from "@ganger/ui";
import { readQuestion } from "@ganger/app/question";
import { useTranslations } from "use-intl";

export function QuestionAnswer({
  body,
  options,
  onSend,
  failed,
}: {
  body: string;
  options: ReadonlyArray<string>;
  onSend: (answer: string) => Promise<void>;
  failed?: string | undefined;
}) {
  const t = useTranslations("question");
  const { lead, choices, after } = readQuestion(body, options);
  return (
    <QuestionForm
      lead={lead}
      choices={choices}
      after={after}
      labels={{
        other: t("other"),
        otherLabel: t("otherLabel"),
        otherPlaceholder: t("otherPlaceholder"),
        answerLabel: t("answerLabel"),
        pick: t("pick"),
        empty: t("empty"),
        note: t("note"),
        shortcut: t("shortcut"),
        send: t("send"),
        sending: t("sending"),
        failed: failed ?? t("failed"),
      }}
      onSend={onSend}
    />
  );
}
