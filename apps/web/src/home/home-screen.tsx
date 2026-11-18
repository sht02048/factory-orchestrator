import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Popover,
  StatusPill,
  Text,
  buttonStyles,
} from "@factory/ui";
import type { PillStatus } from "@factory/ui";
import { colors, fontSize, fontWeight, lineHeight, radius, space } from "@factory/ui/tokens.stylex";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { runStatus, useStatusName } from "../status";
import type { AnswerDraft } from "./answer-draft";
import { answerToSend, emptyDraft, pickChoice, pickOther, writeOther } from "./answer-draft";
import type { DoneRun, HomePage, HomeRun, InputWait, RunnersSummary } from "./model";
import { objectParticle, subjectParticle } from "./particle";

export interface AnswerInput {
  runId: string;
  questionId: string;
  answer: string;
}

export interface DenyInput {
  runId: string;
  promptId: string;
  reason: string;
}

export interface HomeScreenProps {
  page: HomePage;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
}

type Question = Extract<InputWait, { kind: "question" }>;
type Permission = Extract<InputWait, { kind: "permission" }>;

export function HomeScreen({ page, onAnswer, onDeny }: HomeScreenProps) {
  const t = useTranslations("home");
  if (page.workspace.kind === "none") {
    return (
      <div {...stylex.props(styles.page)}>
        <PageHeader title={t("title")} />
        <Text variant="body">{t("noWorkspace")}</Text>
      </div>
    );
  }
  const all = page.workspace.kind === "all";
  const counts = { todo: page.attention.length, runners: page.runners.issues.length };
  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={t("title")}
        subtitle={all ? t("summaryAll", counts) : t("summary", counts)}
      />
      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.columns)}>
          <div {...stylex.props(styles.column)}>
            <TodoSection page={page} all={all} onAnswer={onAnswer} onDeny={onDeny} />
            {all ? null : <InProgressSection page={page} />}
          </div>
          <div {...stylex.props(styles.column)}>
            <RunnersCard runners={page.runners} />
            {all ? null : <DoneTodayCard page={page} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TitledSection({
  title,
  aside,
  quiet = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  quiet?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <Card padding="compact">
        <div {...stylex.props(styles.cardHead)}>
          <h2 id={titleId} {...stylex.props(styles.sectionTitle, quiet && styles.quietTitle)}>
            {title}
          </h2>
          {aside}
        </div>
        {children}
      </Card>
    </section>
  );
}

function TodoSection({
  page,
  all,
  onAnswer,
  onDeny,
}: {
  page: HomePage;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home");
  return (
    <TitledSection title={t("section.todo")}>
      {page.attention.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{t("empty.todo")}</p>
      ) : (
        <ul {...stylex.props(styles.rows)}>
          {page.attention.map(({ run }) => (
            <TodoRow key={run.id} run={run} all={all} onAnswer={onAnswer} onDeny={onDeny} />
          ))}
        </ul>
      )}
    </TitledSection>
  );
}

function InProgressSection({ page }: { page: HomePage }) {
  const t = useTranslations("home");
  const statusName = useStatusName();
  const runs = [...page.running, ...page.queued];
  return (
    <TitledSection
      title={t("section.inProgress")}
      aside={
        <>
          <span {...stylex.props(styles.headCounts)}>
            {t("inProgress.counts", {
              running: statusName("running"),
              runningCount: page.running.length,
              queued: statusName("queued"),
              queuedCount: page.queued.length,
            })}
          </span>
          <HeadLink href={runsHref(page)}>{t("inProgress.link")}</HeadLink>
        </>
      }
    >
      {runs.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{t("empty.inProgress")}</p>
      ) : (
        <ul {...stylex.props(styles.rows)}>
          {runs.map((run) => (
            <ProgressRow key={run.id} run={run} />
          ))}
        </ul>
      )}
    </TitledSection>
  );
}

function runsHref(page: HomePage): string {
  return page.workspace.kind === "one"
    ? href("/runs", { ws: page.workspace.workspace.id })
    : "/runs";
}

function HeadLink({ href: to, children }: { href: string; children: ReactNode }) {
  return (
    <a href={to} {...stylex.props(styles.headLink)}>
      {children}
    </a>
  );
}

function RunRow({
  run,
  status,
  all = false,
  reason,
  action,
}: {
  run: HomeRun;
  status: PillStatus;
  all?: boolean;
  reason: ReactNode;
  action?: ReactNode;
}) {
  const t = useTranslations("home.row");
  const statusName = useStatusName();
  return (
    <li data-run={run.id} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.lead)}>
        <StatusPill status={status}>{statusName(status)}</StatusPill>
        <a href={runHref(run)} {...stylex.props(styles.title)}>
          {run.ticketKey}
        </a>
        {all ? <span {...stylex.props(styles.meta)}>{run.workspace.name}</span> : null}
        {run.cancelling ? <span {...stylex.props(styles.meta)}>{t("cancelling")}</span> : null}
      </span>
      <span {...stylex.props(styles.trail)}>
        <span {...stylex.props(styles.reason)}>{reason}</span>
        {action}
      </span>
    </li>
  );
}

function runHref(run: { id: string; workspace: { id: string } }): string {
  return href(`/runs/${encodeURIComponent(run.id)}`, { ws: run.workspace.id });
}

function todoStatus(run: HomeRun): PillStatus {
  if (run.state === "waiting-for-input" && run.input !== null) return run.input.kind;
  return runStatus(run.state === "ended" ? run : { state: run.state });
}

function TodoRow({
  run,
  all,
  onAnswer,
  onDeny,
}: {
  run: HomeRun;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home.row");
  const { duration } = useTime();
  const status = todoStatus(run);
  const row = (reason: ReactNode, action?: ReactNode) => (
    <RunRow run={run} status={status} all={all} reason={reason} action={action} />
  );
  const inputReasonAndAction = (waiting: HomeRun, input: InputWait): [ReactNode, ReactNode] => {
    switch (input.kind) {
      case "question":
        return [input.body, <QuestionAction run={waiting} question={input} onAnswer={onAnswer} />];
      case "permission":
        return [
          t("permission", { command: input.detail, object: objectParticle(input.detail) }),
          <PermissionAction run={waiting} permission={input} onDeny={onDeny} />,
        ];
    }
  };
  switch (run.state) {
    case "waiting-for-input":
      return run.input === null
        ? row(t("inputUnknown"))
        : row(...inputReasonAndAction(run, run.input));
    case "disconnected": {
      const runner = run.runner?.name ?? t("noRunner");
      return row(
        run.unreachableMs === null
          ? t("unreachable", { runner })
          : t("unreachableFor", { runner, duration: duration(run.unreachableMs) }),
      );
    }
    case "ended": {
      if (run.summary !== "human-check") return row(t("failed"));
      const pr = run.pullRequest;
      if (pr === null) return row(t("humanCheckNoPr"));
      return row(
        t("humanCheck", { pr: pr.displayId, object: objectParticle(pr.displayId) }),
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          data-variant="secondary"
          {...stylex.props(...buttonStyles("secondary"))}
        >
          {t("openPr")}
        </a>,
      );
    }
    case "queued":
    case "running":
      return null;
  }
}

function ProgressRow({ run }: { run: HomeRun }) {
  const t = useTranslations("home.row");
  const tDomain = useTranslations("domain");
  const { elapsed } = useTime();
  switch (run.state) {
    case "running": {
      const parts = [
        run.runner?.name,
        run.executionMs === null ? undefined : elapsed(run.executionMs),
      ].filter((part) => part !== undefined);
      return <RunRow run={run} status="running" reason={parts.join(" · ")} />;
    }
    case "queued": {
      const reason = run.queuedReason;
      let text: string;
      switch (reason.kind) {
        case "behind":
        case "no-capacity":
          text = t("queuedFree");
          break;
        case "runner-offline":
          text =
            run.runner === null
              ? t("queuedAnyOffline")
              : t("queuedOffline", {
                  runner: run.runner.name,
                  subject: subjectParticle(run.runner.name),
                });
          break;
        case "starting":
        case "project-missing":
        case "assignment-blocked":
          text = tDomain(`queuedReason.${reason.kind}`);
          break;
      }
      return <RunRow run={run} status="queued" reason={text} />;
    }
    case "waiting-for-input":
    case "disconnected":
    case "ended":
      return null;
  }
}

function useResultFocus(done: boolean) {
  const resultRef = useRef<HTMLSpanElement>(null);
  const awaiting = useRef(false);
  useEffect(() => {
    if (!done || !awaiting.current) return;
    awaiting.current = false;
    resultRef.current?.focus();
  }, [done]);
  return {
    resultRef,
    sending: () => {
      awaiting.current = true;
    },
    failed: () => {
      awaiting.current = false;
    },
  };
}

function useLayer() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusTriggerOnClose = useRef(false);
  useEffect(() => {
    if (open || !focusTriggerOnClose.current) return;
    focusTriggerOnClose.current = false;
    triggerRef.current?.focus();
  }, [open]);
  return {
    open,
    triggerRef,
    onOpenChange: (next: boolean) => {
      focusTriggerOnClose.current = !next;
      setOpen(next);
    },
    closeAfterSend: () => {
      focusTriggerOnClose.current = false;
      setOpen(false);
    },
  };
}

function ResultText({
  resultRef,
  children,
}: {
  resultRef: RefObject<HTMLSpanElement | null>;
  children: string;
}) {
  return (
    <span ref={resultRef} role="status" tabIndex={-1} {...stylex.props(styles.result)}>
      {children}
    </span>
  );
}

function LayerTitle({ run, status, since }: { run: HomeRun; status: PillStatus; since: string }) {
  const statusName = useStatusName();
  return (
    <>
      <StatusPill status={status}>{statusName(status)}</StatusPill>
      <span {...stylex.props(styles.key)}>{run.ticketKey}</span>
      {since === "" ? null : <span>{since}</span>}
    </>
  );
}

function QuestionAction({
  run,
  question,
  onAnswer,
}: {
  run: HomeRun;
  question: Question;
  onAnswer: HomeScreenProps["onAnswer"];
}) {
  const t = useTranslations("home");
  const { elapsed } = useTime();
  const layer = useLayer();
  const result = useResultFocus(question.answered);
  if (question.answered)
    return <ResultText resultRef={result.resultRef}>{t("question.answered")}</ResultText>;
  const waitingMs = run.state === "waiting-for-input" ? run.waitingMs : null;
  return (
    <Popover
      trigger={t("row.answer")}
      triggerRef={layer.triggerRef}
      title={
        <LayerTitle
          run={run}
          status="question"
          since={waitingMs === null ? "" : elapsed(waitingMs)}
        />
      }
      closeLabel={t("question.close")}
      initialFocus='input[type="radio"]'
      open={layer.open}
      onOpenChange={layer.onOpenChange}
    >
      <QuestionForm
        question={question}
        onSend={async (answer) => {
          result.sending();
          try {
            await onAnswer({ runId: run.id, questionId: question.questionId, answer });
          } catch (error) {
            result.failed();
            throw error;
          }
          layer.closeAfterSend();
        }}
      />
    </Popover>
  );
}

type SendState = "idle" | "sending" | "failed";

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

function PermissionAction({
  run,
  permission,
  onDeny,
}: {
  run: HomeRun;
  permission: Permission;
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home");
  const { elapsed } = useTime();
  const layer = useLayer();
  const result = useResultFocus(permission.denied);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  if (permission.denied)
    return <ResultText resultRef={result.resultRef}>{t("permission.denied")}</ResultText>;
  const sending = state === "sending";
  const waitingMs = run.state === "waiting-for-input" ? run.waitingMs : null;
  return (
    <Popover
      trigger={t("row.deny")}
      triggerVariant="danger"
      triggerRef={layer.triggerRef}
      title={
        <LayerTitle
          run={run}
          status="permission"
          since={waitingMs === null ? "" : elapsed(waitingMs)}
        />
      }
      closeLabel={t("permission.close")}
      initialFocus='input[name="reason"]'
      open={layer.open}
      onOpenChange={layer.onOpenChange}
    >
      <form
        {...stylex.props(styles.layerForm)}
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) return;
          setState("sending");
          result.sending();
          onDeny({ runId: run.id, promptId: permission.promptId, reason: reason.trim() }).then(
            () => {
              setState("idle");
              layer.closeAfterSend();
            },
            () => {
              result.failed();
              setState("failed");
            },
          );
        }}
      >
        <p {...stylex.props(styles.questionText)}>{permission.detail}</p>
        <Field
          label={t("permission.reasonLabel")}
          description={t("permission.reasonDescription")}
          error={state === "failed" ? t("permission.failed") : undefined}
        >
          <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
        </Field>
        <div {...stylex.props(styles.layerFoot)}>
          <span />
          <Button variant="danger" type="submit" disabled={sending}>
            {sending ? t("permission.denying") : t("permission.send")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function RunnersCard({ runners }: { runners: RunnersSummary }) {
  const t = useTranslations("home");
  const statusName = useStatusName();
  const issues = runners.issues;
  return (
    <TitledSection
      title={t("section.runners")}
      quiet
      aside={
        <>
          {issues.length === 0 ? null : (
            <span {...stylex.props(styles.headCounts)}>
              {t("runners.check", { count: issues.length })}
            </span>
          )}
          <HeadLink href="/runners">{t("runners.link")}</HeadLink>
        </>
      }
    >
      {issues.length === 0 && runners.online === 0 ? (
        <p {...stylex.props(styles.empty)}>{t("empty.runners")}</p>
      ) : (
        <ul {...stylex.props(styles.rows)}>
          {issues.map((runner) => (
            <li key={runner.id} data-runner={runner.id} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.lead)}>
                <StatusPill status="runner-issue">{statusName("runner-issue")}</StatusPill>
                <a href={href("/runners", { sel: runner.id })} {...stylex.props(styles.title)}>
                  {runner.name}
                </a>
              </span>
              <span {...stylex.props(styles.trail)}>
                <span {...stylex.props(styles.reason)}>{t(`runners.${runner.cause}`)}</span>
              </span>
            </li>
          ))}
          {runners.online === 0 ? null : (
            <li {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.lead)}>
                <StatusPill status="online">{statusName("online")}</StatusPill>
                <span {...stylex.props(styles.reason)}>
                  {t("runners.online", { count: runners.online })}
                </span>
              </span>
            </li>
          )}
        </ul>
      )}
    </TitledSection>
  );
}

function DoneTodayCard({ page }: { page: HomePage }) {
  const t = useTranslations("home");
  const statusName = useStatusName();
  const { ago } = useTime();
  const done = page.doneToday;
  return (
    <TitledSection
      title={t("section.doneToday")}
      quiet
      aside={
        <>
          <span {...stylex.props(styles.headCounts)}>
            {t("doneToday.count", { count: done.total })}
          </span>
          <HeadLink href={runsHref(page)}>{t("doneToday.link")}</HeadLink>
        </>
      }
    >
      {done.recent.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{t("empty.doneToday")}</p>
      ) : (
        <ul {...stylex.props(styles.rows)}>
          {done.recent.map((run) => (
            <DoneRow
              key={run.id}
              run={run}
              statusLabel={statusName(run.summary)}
              time={ago(run.endedAt, run.endedAgoMs)}
            />
          ))}
        </ul>
      )}
    </TitledSection>
  );
}

function DoneRow({ run, statusLabel, time }: { run: DoneRun; statusLabel: string; time: string }) {
  return (
    <li data-run={run.id} {...stylex.props(styles.row, styles.rowSingleLine)}>
      <span {...stylex.props(styles.lead)}>
        <StatusPill status={run.summary}>{statusLabel}</StatusPill>
        <a href={runHref(run)} {...stylex.props(styles.title)}>
          {run.ticketKey}
        </a>
      </span>
      <span {...stylex.props(styles.trailCompact)}>
        <time dateTime={run.endedAt} {...stylex.props(styles.reason)}>
          {time}
        </time>
      </span>
    </li>
  );
}

function href(path: string, search: Record<string, string>): string {
  return `${path}?${new URLSearchParams(search).toString()}`;
}

const STACKED = "@container (max-width: 879px)";
const SIDE_WIDTH = 360;

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: { default: space.s8, "@media (max-width: 600px)": space.s4 },
    paddingBottom: space.s10,
  },
  frame: { containerType: "inline-size" },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) minmax(0, ${SIDE_WIDTH}px)`,
      [STACKED]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s4,
  },
  column: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  cardHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
  },
  sectionTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  quietTitle: { color: colors.textSecondary, fontSize: fontSize.ui },
  headCounts: {
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
  headLink: {
    marginInlineStart: "auto",
    color: colors.accentText,
    fontSize: fontSize.ui,
    textDecoration: { default: "none", ":hover": "underline" },
    whiteSpace: "nowrap",
    borderRadius: radius.pill,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  empty: {
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: colors.textTertiary,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
    minHeight: 44,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.control,
  },
  lead: {
    display: "flex",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    maxWidth: "100%",
  },
  trail: {
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    minWidth: "min(100%, 12rem)",
    maxWidth: "100%",
  },
  trailCompact: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    marginInlineStart: "auto",
    whiteSpace: "nowrap",
  },
  rowSingleLine: { flexWrap: "nowrap" },
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
    textDecoration: { default: "none", ":hover": "underline" },
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderRadius: radius.pill,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  meta: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    whiteSpace: "nowrap",
  },
  key: {
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  reason: {
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
    lineHeight: lineHeight.snug,
    overflowWrap: "anywhere",
  },
  result: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    outline: "none",
  },
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
