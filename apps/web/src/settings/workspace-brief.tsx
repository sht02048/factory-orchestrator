import * as stylex from "@stylexjs/stylex";
import {
  Button,
  CodeBlock,
  Field,
  InfoTip,
  SettingsRow,
  Text,
  Textarea,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import {
  WORKSPACE_BRIEF_MAX_LENGTH,
  agentBriefParts,
  ticketBriefText,
  workspaceBriefLength,
  type AgentBriefPartKind,
  type WorkspaceBrief,
} from "@ganger/core";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "use-intl";
import type { WorkspaceSettings } from "@ganger/app/settings/model";
import { CredentialFormFrame } from "./credential-forms";
import { useFocusFirstField, useInlineEdit, type InlineEdit } from "./row-state";
import { SubmitError, useReportUnsaved, useSubmit, type SettingsActions } from "./settings-screen";

type BriefField = keyof WorkspaceBrief;

export function WorkspaceBriefRow({
  workspace,
  actions,
  changeButton,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  changeButton: (edit: InlineEdit, label: string) => ReactNode;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("workspace-brief");
  const { general } = workspace;
  const label = t("brief.title");
  return (
    <SettingsRow
      label={label}
      info={<InfoTip label={t("infoLabel", { label })} content={t("brief.info")} />}
      detail={edit.open ? undefined : <BriefSummary brief={general.brief} />}
      control={edit.open ? undefined : changeButton(edit, label)}
      formOnly
      expanded={
        edit.open ? (
          <BriefEditor
            ws={general.id}
            initial={general.brief}
            protocol={general.agentProtocol}
            save={actions.saveBrief}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

function lineCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

function BriefSummary({ brief }: { brief: WorkspaceBrief }) {
  const t = useTranslations("settings.brief");
  const before = lineCount(brief.before);
  const after = lineCount(brief.after);
  if (before === 0 && after === 0) return t("summaryEmpty");
  return t("summary", { before, after });
}

function BriefEditor({
  ws,
  initial,
  protocol,
  save,
  onClose,
}: {
  ws: string;
  initial: WorkspaceBrief;
  protocol: string;
  save: SettingsActions["saveBrief"];
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const [draft, setDraft] = useState<WorkspaceBrief>(initial);
  const [tooLong, setTooLong] = useState<ReadonlySet<BriefField>>(new Set());
  const beforeRef = useRef<HTMLTextAreaElement>(null);
  const afterRef = useRef<HTMLTextAreaElement>(null);
  useReportUnsaved(draft.before !== initial.before || draft.after !== initial.after);
  const submit = useSubmit();
  const focusRef = useFocusFirstField();
  const overLimit = (field: BriefField, value: string) =>
    workspaceBriefLength(value.trim()) > WORKSPACE_BRIEF_MAX_LENGTH ? [field] : [];
  const change = (field: BriefField, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (tooLong.size > 0) {
      setTooLong(new Set([...overLimit("before", next.before), ...overLimit("after", next.after)]));
    }
  };
  return (
    <div ref={focusRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
      <CredentialFormFrame
        onClose={onClose}
        footer={<Text variant="meta">{t("brief.appliesToNewRuns")}</Text>}
        onSubmit={() => {
          const invalid = new Set([
            ...overLimit("before", draft.before),
            ...overLimit("after", draft.after),
          ]);
          setTooLong(invalid);
          if (invalid.has("before")) {
            beforeRef.current?.focus();
            return;
          }
          if (invalid.has("after")) {
            afterRef.current?.focus();
            return;
          }
          submit.run(
            () => save({ ws, before: draft.before, after: draft.after }),
            t("brief.saved"),
            onClose,
          );
        }}
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        }
      >
        <div {...stylex.props(styles.editor)}>
          <div {...stylex.props(styles.fields)}>
            <BriefTextField
              field="before"
              value={draft.before}
              tooLong={tooLong.has("before")}
              onChange={(value) => change("before", value)}
              textareaRef={beforeRef}
            />
            <BriefTextField
              field="after"
              value={draft.after}
              tooLong={tooLong.has("after")}
              onChange={(value) => change("after", value)}
              textareaRef={afterRef}
            />
          </div>
          <BriefPreview brief={draft} protocol={protocol} />
        </div>
        <SubmitError state={submit.state} />
      </CredentialFormFrame>
    </div>
  );
}

function BriefTextField({
  field,
  value,
  tooLong,
  onChange,
  textareaRef,
}: {
  field: BriefField;
  value: string;
  tooLong: boolean;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations("settings.brief");
  const settings = useTranslations("settings");
  const label = t(`${field}.label`);
  const countId = useId();
  return (
    <Field
      label={label}
      info={<InfoTip label={settings("infoLabel", { label })} content={t(`${field}.info`)} />}
      error={tooLong ? t("tooLong", { max: WORKSPACE_BRIEF_MAX_LENGTH }) : undefined}
      description={
        <span id={countId}>
          {t("count", { count: workspaceBriefLength(value), max: WORKSPACE_BRIEF_MAX_LENGTH })}
        </span>
      }
    >
      <Textarea
        ref={textareaRef}
        name={`brief-${field}`}
        rows={5}
        value={value}
        onValueChange={onChange}
        placeholder={t(`${field}.placeholder`)}
        aria-describedby={countId}
      />
    </Field>
  );
}

export function BriefPreview({ brief, protocol }: { brief: WorkspaceBrief; protocol: string }) {
  const t = useTranslations("settings.brief");
  const headingId = useId();
  const parts = agentBriefParts({
    workspace: brief,
    ticket: ticketBriefText({ title: t("example.title"), body: t("example.body") }),
    protocol,
  });
  return (
    <section aria-labelledby={headingId} {...stylex.props(styles.preview)}>
      <div {...stylex.props(styles.previewHead)}>
        <Text variant="ui" as="p" id={headingId}>
          {t("preview.title")}
        </Text>
        <Text variant="meta" as="p">
          {t("preview.description", { key: t("example.key") })}
        </Text>
      </div>
      <ol {...stylex.props(styles.parts)}>
        {parts.map((part) => (
          <li key={part.kind} {...stylex.props(styles.part)}>
            <Text variant="meta" as="p">
              {partLabel(t, part.kind)}
            </Text>
            <CodeBlock scroll={part.kind === "protocol"} label={partLabel(t, part.kind)}>
              {part.text}
            </CodeBlock>
          </li>
        ))}
      </ol>
    </section>
  );
}

function partLabel(
  t: ReturnType<typeof useTranslations<"settings.brief">>,
  kind: AgentBriefPartKind,
): string {
  switch (kind) {
    case "before":
      return t("preview.before");
    case "ticket":
      return t("preview.ticket");
    case "after":
      return t("preview.after");
    case "protocol":
      return t("preview.protocol");
  }
}

const styles = stylex.create({
  editor: { display: "flex", flexDirection: "column", gap: space.s5 },
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
  preview: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  previewHead: { display: "flex", flexDirection: "column", gap: space.s1 },
  parts: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  part: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
});
