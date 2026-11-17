import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  DetailPanel,
  Field,
  Input,
  PageHeader,
  PanelBlock,
  Section,
  SplitView,
  Status,
  Text,
} from "@factory/ui";
import type { StatusTone } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight, radius, space } from "@factory/ui/tokens.stylex";
import type { SummaryOutcome } from "@factory/core";
import { useState } from "react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useFormatDuration } from "../format/duration";
import { canCancel } from "./model";
import type { LogTailView, PendingInput, RunDetail, RunDetailPage, TimelineEvent } from "./model";

export interface RunDetailActions {
  /** 질문에 답한다. 답을 DB 에 남기고 worker 가 보낸다(Q82.3) */
  onAnswer: (questionId: string, body: string) => Promise<void>;
  /** 권한 대기를 거절한다(Q82.4). 허용은 러너 화면에서만 한다. 이유는 비어도 된다 */
  onDeny: (promptId: string, reason: string) => Promise<void>;
  /** 취소를 요청한다(Q77·Q82.8) */
  onCancel: () => Promise<void>;
  /** 로그 꼬리를 다시 요청한다 */
  onRefreshLog: () => void;
}

export interface RunDetailScreenProps extends RunDetailActions {
  page: RunDetailPage;
  /** Runs 목록 주소 */
  runsHref: string;
  /** 다른 런의 상세 주소 */
  runHref: (runId: string) => string;
}

/** Run 상세: 왼쪽 결과·타임라인·로그, 오른쪽 런 속성과 같은 티켓의 다른 런(ADR 0007, 시안 B) */
export function RunDetailScreen(props: RunDetailScreenProps) {
  const { page } = props;
  if (page.kind === "not-found") return <NotFound runsHref={props.runsHref} />;
  return (
    <SplitView
      list={<Main {...props} run={page.run} />}
      panel={<Properties run={page.run} runHref={props.runHref} />}
    />
  );
}

function NotFound({ runsHref }: { runsHref: string }) {
  const t = useTranslations("run.notFound");
  return (
    <div {...stylex.props(styles.notice)}>
      <PageHeader title={t("title")} />
      <Text variant="body">{t("body")}</Text>
      <a href={runsHref} {...stylex.props(styles.link)}>
        {t("back")}
      </a>
    </div>
  );
}

function Main(props: RunDetailScreenProps & { run: RunDetail }) {
  const { run } = props;
  const t = useTranslations("run");
  const status = useStatusLine();
  const { tone, label, when } = status(run);
  const pr = run.pullRequest;

  return (
    <div {...stylex.props(styles.main)}>
      <nav aria-label={t("crumb.label")} {...stylex.props(styles.crumb)}>
        <a href={props.runsHref} {...stylex.props(styles.link)}>
          {t("crumb.runs")}
        </a>
        <span aria-hidden="true">/</span>
        <span>{t("crumb.run", { ticket: run.ticketKey })}</span>
      </nav>

      <header {...stylex.props(styles.head)}>
        <p {...stylex.props(styles.stateLine)}>
          <Status tone={tone}>{label}</Status>
          <Text variant="meta">{when}</Text>
          {run.cancelPending ? <Text variant="meta">{t("cancelPending")}</Text> : null}
        </p>
        <Text variant="page" as="h1">
          {run.ticketKey}
        </Text>
        <Text variant="meta">
          {run.branch === null ? run.trackerProject : `${run.trackerProject} · ${run.branch}`}
        </Text>
        <Text variant="body">
          <Reason run={run} />
        </Text>
        {pr === null && !canCancel(run) ? null : (
          <Actions>
            {pr === null ? null : (
              <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
                {t("openPr", { pr: pr.displayId })}
              </a>
            )}
            {canCancel(run) && !run.cancelPending ? <CancelRun onCancel={props.onCancel} /> : null}
          </Actions>
        )}
      </header>

      {run.status.state === "waiting-for-input" ? (
        <InputBlock input={run.status.input} onAnswer={props.onAnswer} onDeny={props.onDeny} />
      ) : null}

      <Section title={t("next.title")}>
        <NextAction run={run} />
      </Section>

      <Section title={t("timeline.title")}>
        <Timeline events={run.timeline} />
      </Section>

      {run.startError === null ? null : (
        <Section title={t("startError.title")}>
          <div {...stylex.props(styles.stack)}>
            <Text variant="body">{t("startError.body")}</Text>
            <pre {...stylex.props(styles.pre)}>{run.startError}</pre>
          </div>
        </Section>
      )}

      {run.status.state === "ended" ? (
        <Section title={t("report.title")}>
          {run.report === null ? (
            <Text variant="meta">{t("report.none")}</Text>
          ) : (
            <pre {...stylex.props(styles.pre)}>{run.report}</pre>
          )}
        </Section>
      ) : null}

      <LogTail log={run.log} onRefresh={props.onRefreshLog} />
    </div>
  );
}

function Reason({ run }: { run: RunDetail }) {
  const t = useTranslations("run.reason");
  const domain = useTranslations("domain");
  const time = useTime();
  const { status } = run;
  switch (status.state) {
    case "queued":
      return status.queuedReason.kind === "no-capacity"
        ? domain("queuedReason.no-capacity", { runner: status.queuedReason.runner })
        : domain(`queuedReason.${status.queuedReason.kind}`);
    case "running":
      return t("running");
    case "waiting-for-input":
      return t(inputKey(status.input));
    case "disconnected":
      return status.unreachableSince === null
        ? t("disconnected")
        : t("disconnectedSince", { time: time(status.unreachableSince) });
    case "ended":
      return t(status.summary);
  }
}

function inputKey(
  input: PendingInput,
): "question" | "answered" | "permission" | "denied" | "waiting-unknown" {
  switch (input.kind) {
    case "question":
      return input.answered ? "answered" : "question";
    case "permission":
      return input.denied ? "denied" : "permission";
    case "unknown":
      return "waiting-unknown";
  }
}

function NextAction({ run }: { run: RunDetail }) {
  const t = useTranslations("run");
  const { status } = run;
  let next: string;
  switch (status.state) {
    case "queued":
    case "running":
    case "disconnected":
      next = t(`next.${status.state}`);
      break;
    case "waiting-for-input":
      next = t(`next.${inputKey(status.input)}`);
      break;
    case "ended":
      next = t(`next.${status.summary}`);
      break;
  }
  const manual = status.state === "ended" && status.worktreeNeedsManualRemoval;
  return (
    <div {...stylex.props(styles.stack)}>
      {manual ? (
        <p {...stylex.props(styles.flat)}>
          <Status tone="failed">{t("manualRemoval")}</Status>
        </p>
      ) : null}
      <Text variant="body">{manual ? t("next.manualRemoval") : next}</Text>
    </div>
  );
}

function InputBlock({
  input,
  onAnswer,
  onDeny,
}: {
  input: PendingInput;
  onAnswer: RunDetailActions["onAnswer"];
  onDeny: RunDetailActions["onDeny"];
}) {
  switch (input.kind) {
    case "question":
      return input.answered ? null : <QuestionForm question={input} onAnswer={onAnswer} />;
    case "permission":
      return input.denied ? null : <PermissionWait wait={input} onDeny={onDeny} />;
    case "unknown":
      return null;
  }
}

type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed" };

function QuestionForm({
  question,
  onAnswer,
}: {
  question: Extract<PendingInput, { kind: "question" }>;
  onAnswer: RunDetailActions["onAnswer"];
}) {
  const t = useTranslations("run");
  const [answer, setAnswer] = useState("");
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  const [empty, setEmpty] = useState(false);

  const send = (body: string) => {
    if (body.trim() === "") {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setSubmit({ kind: "sending" });
    onAnswer(question.questionId, body).then(
      () => setSubmit({ kind: "sent" }),
      () => setSubmit({ kind: "failed" }),
    );
  };

  return (
    <Section title={t("question.title")}>
      <div {...stylex.props(styles.stack)}>
        <pre {...stylex.props(styles.question)}>{question.body}</pre>
        {submit.kind === "sent" ? (
          <Text variant="body">{t("question.sent")}</Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              send(answer);
            }}
          >
            {question.choices.length === 0 ? null : (
              <div {...stylex.props(styles.stack)}>
                <Text variant="label">{t("question.choicesLabel")}</Text>
                <Actions>
                  {question.choices.map((choice) => (
                    <Button
                      key={choice}
                      disabled={submit.kind === "sending"}
                      onClick={() => send(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </Actions>
              </div>
            )}
            <Field
              label={t("question.answerLabel")}
              description={t("question.answerHelp")}
              {...(empty ? { error: t("question.empty") } : {})}
            >
              <Input name="answer" value={answer} onValueChange={setAnswer} autoComplete="off" />
            </Field>
            <Actions>
              <Button type="submit" variant="primary" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("question.submitting") : t("question.submit")}
              </Button>
            </Actions>
            {submit.kind === "failed" ? <Text variant="body">{t("actionFailed")}</Text> : null}
          </form>
        )}
      </div>
    </Section>
  );
}

function PermissionWait({
  wait,
  onDeny,
}: {
  wait: Extract<PendingInput, { kind: "permission" }>;
  onDeny: RunDetailActions["onDeny"];
}) {
  const t = useTranslations("run");
  const [reason, setReason] = useState("");
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  return (
    <Section title={t("permission.title")}>
      <div {...stylex.props(styles.stack)}>
        <pre {...stylex.props(styles.question)}>{wait.detail}</pre>
        <Text variant="body">{t("permission.body")}</Text>
        {submit.kind === "sent" ? (
          <Text variant="body">{t("permission.denied")}</Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              setSubmit({ kind: "sending" });
              onDeny(wait.promptId, reason).then(
                () => setSubmit({ kind: "sent" }),
                () => setSubmit({ kind: "failed" }),
              );
            }}
          >
            <Field label={t("permission.reasonLabel")} description={t("permission.reasonHelp")}>
              <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
            </Field>
            <Actions>
              <Button type="submit" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("permission.denying") : t("permission.deny")}
              </Button>
            </Actions>
          </form>
        )}
        {submit.kind === "failed" ? <Text variant="body">{t("actionFailed")}</Text> : null}
      </div>
    </Section>
  );
}

function CancelRun({ onCancel }: { onCancel: RunDetailActions["onCancel"] }) {
  const t = useTranslations("run");
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Dialog
        trigger={t("cancel.trigger")}
        triggerVariant="ghost"
        title={t("cancel.title")}
        description={t("cancel.body")}
        actions={
          <>
            <DialogClose>{t("cancel.dismiss")}</DialogClose>
            <DialogClose
              variant="primary"
              onClick={() => {
                setFailed(false);
                onCancel().catch(() => setFailed(true));
              }}
            >
              {t("cancel.confirm")}
            </DialogClose>
          </>
        }
      />
      {failed ? <Text variant="meta">{t("actionFailed")}</Text> : null}
    </>
  );
}

function Timeline({ events }: { events: ReadonlyArray<TimelineEvent> }) {
  const t = useTranslations("run.timeline");
  const domain = useTranslations("domain");
  const laterPr = useTranslations("run.laterPr");
  const time = useTime();
  const eventDetail = (event: TimelineEvent): string | null => {
    switch (event.kind) {
      case "question":
      case "answer":
      case "permission":
        return event.body;
      case "denied":
        return event.body === "" ? null : event.body;
      case "ended":
        return domain(`agentResult.${event.agentResult}`);
      case "later-pr":
        return laterPr(event.state);
      case "assigned":
      case "started":
      case "waiting-for-input":
      case "resumed":
      case "unreachable":
      case "disconnected":
      case "reconnected":
      case "cancel-requested":
        return null;
    }
  };
  return (
    <ol {...stylex.props(styles.timeline)}>
      {events.map((event, index) => {
        const detail = eventDetail(event);
        return (
          <li key={`${event.kind}-${index}`} {...stylex.props(styles.event)}>
            <time dateTime={event.at} {...stylex.props(styles.eventTime)}>
              {time(event.at)}
            </time>
            <div {...stylex.props(styles.eventBody)}>
              <span>{t(event.kind)}</span>
              {detail === null ? null : <span {...stylex.props(styles.eventDetail)}>{detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function LogTail({ log, onRefresh }: { log: LogTailView; onRefresh: () => void }) {
  const t = useTranslations("run.log");
  const time = useTime();
  let note: string | undefined;
  let body: ReactNode;
  switch (log.kind) {
    case "none":
      body = <Text variant="meta">{t("none")}</Text>;
      break;
    case "pending":
      body = <Text variant="meta">{t("pending")}</Text>;
      break;
    case "failed":
      note = time(log.at);
      body = <Text variant="body">{t("failed", { error: log.error })}</Text>;
      break;
    case "stored":
      note = t("stored", { count: log.lines.length });
      body = <LogLines lines={log.lines} />;
      break;
    case "done":
      note = t("fetched", { time: time(log.at), count: log.lines.length });
      body = <LogLines lines={log.lines} />;
      break;
  }
  const live = log.kind === "done" || log.kind === "failed";
  return (
    <Section title={t("title")} {...(note === undefined ? {} : { note })}>
      <div {...stylex.props(styles.stack)}>
        {body}
        {live ? (
          <Actions>
            <Button variant="ghost" onClick={onRefresh}>
              {t("refresh")}
            </Button>
          </Actions>
        ) : null}
      </div>
    </Section>
  );
}

function LogLines({ lines }: { lines: ReadonlyArray<string> }) {
  const t = useTranslations("run.log");
  if (lines.length === 0) return <Text variant="meta">{t("empty")}</Text>;
  return <pre {...stylex.props(styles.pre, styles.log)}>{lines.join("\n")}</pre>;
}

function Properties({ run, runHref }: { run: RunDetail; runHref: (runId: string) => string }) {
  const t = useTranslations("run.props");
  const domain = useTranslations("domain");
  const ci = useTranslations("run.ci");
  const laterPr = useTranslations("run.laterPr");
  const other = useTranslations("run.otherRuns");
  const duration = useFormatDuration();
  const time = useTime();
  const ended = run.status.state === "ended" ? run.status : null;
  const pr = run.pullRequest;

  return (
    <DetailPanel>
      <section aria-label={t("label")} {...stylex.props(styles.stack)}>
        <DefinitionList>
          <DefinitionItem label={t("ticket")}>{run.ticketKey}</DefinitionItem>
          <DefinitionItem label={t("state")}>
            {domain(`runState.${run.status.state}`)}
          </DefinitionItem>
          <DefinitionItem label={t("summary")} empty={ended === null}>
            {ended === null ? (
              t("notEnded")
            ) : (
              <Status tone={summaryTone(ended.summary)}>
                {domain(`summary.${ended.summary}`)}
              </Status>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("agentResult")} empty={ended === null}>
            {ended === null ? t("notEnded") : domain(`agentResult.${ended.agentResult}`)}
          </DefinitionItem>
          <DefinitionItem label={t("prState")} empty={ended === null}>
            {ended === null ? t("notEnded") : domain(`prState.${ended.prState}`)}
          </DefinitionItem>
          {ended?.laterPrState == null ? null : (
            <DefinitionItem label={t("laterPrState")}>
              {t("laterPr", {
                state: laterPr(ended.laterPrState.state),
                time: time(ended.laterPrState.at),
              })}
            </DefinitionItem>
          )}
          <DefinitionItem label={t("pr")} empty={pr === null}>
            {pr === null ? (
              t("none")
            ) : (
              <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
                {pr.displayId}
              </a>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("ci")} empty={pr === null}>
            {pr === null ? t("none") : ci(pr.ci)}
          </DefinitionItem>
          <DefinitionItem label={t("runner")} empty={run.runner === null}>
            {run.runner === null ? (
              t("noRunner")
            ) : (
              <span {...stylex.props(styles.inline)}>
                {run.runner.name}
                {run.runner.online ? null : <Text variant="meta">{t("runnerOffline")}</Text>}
              </span>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("agent")}>{run.agent}</DefinitionItem>
          <DefinitionItem label={t("waited")}>{duration(run.waitMs)}</DefinitionItem>
          <DefinitionItem label={t("executed")} empty={run.executionMs === null}>
            {run.executionMs === null ? t("notStarted") : duration(run.executionMs)}
          </DefinitionItem>
          <DefinitionItem label={t("branch")} empty={run.branch === null}>
            {run.branch === null ? (
              t("notStarted")
            ) : (
              <span {...stylex.props(styles.mono)}>{run.branch}</span>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("worktree")} empty={run.worktree === null}>
            {run.worktree === null ? (
              t("notStarted")
            ) : (
              <span {...stylex.props(styles.mono)}>{run.worktree}</span>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("workspace")}>
            <span {...stylex.props(styles.inline)}>
              {run.workspace.name}
              <Text variant="meta">{run.trackerProject}</Text>
            </span>
          </DefinitionItem>
        </DefinitionList>
      </section>
      {run.otherRuns.length === 0 ? null : (
        <PanelBlock title={other("title")}>
          <ol {...stylex.props(styles.others)}>
            {run.otherRuns.map((o) => (
              <li key={o.id}>
                <a href={runHref(o.id)} {...stylex.props(styles.link)}>
                  {other("item", {
                    time: time(o.assignedAt),
                    state:
                      o.summary === null
                        ? domain(`runState.${o.state}`)
                        : domain(`summary.${o.summary}`),
                  })}
                </a>
              </li>
            ))}
          </ol>
        </PanelBlock>
      )}
    </DetailPanel>
  );
}

function summaryTone(summary: SummaryOutcome): StatusTone {
  switch (summary) {
    case "human-check":
      return "check";
    case "failed":
      return "failed";
    case "merged":
    case "canceled":
      return "neutral";
  }
}

/** 상태 줄: Ended 는 요약 결과, 그 밖은 런 상태. 색은 Human Check·Failed 에만 쓴다(ADR 0007) */
function useStatusLine(): (run: RunDetail) => { tone: StatusTone; label: string; when: string } {
  const t = useTranslations("run.when");
  const domain = useTranslations("domain");
  const duration = useFormatDuration();
  return (run) => {
    const { status } = run;
    switch (status.state) {
      case "ended":
        return {
          tone: summaryTone(status.summary),
          label: domain(`summary.${status.summary}`),
          when: t("endedAfter", { duration: duration(run.executionMs ?? 0) }),
        };
      case "queued":
        return {
          tone: "neutral",
          label: domain("runState.queued"),
          when: t("waitingFor", { duration: duration(run.waitMs) }),
        };
      case "running":
      case "waiting-for-input":
      case "disconnected":
        return {
          tone: "running",
          label: domain(`runState.${status.state}`),
          when: t("elapsedFor", { duration: duration(run.executionMs ?? 0) }),
        };
    }
  };
}

/** 시각을 "11. 17. 09:30"처럼 쓴다. 표시 시간대는 i18n 설정을 따른다 */
function useTime(): (iso: string) => string {
  const format = useFormatter();
  return (iso) =>
    format.dateTime(new Date(iso), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
}

const styles = stylex.create({
  notice: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    paddingTop: space.s6,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  crumb: {
    display: "flex",
    gap: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
  },
  head: { display: "flex", flexDirection: "column", gap: space.s2 },
  stateLine: { display: "flex", alignItems: "baseline", gap: space.s3, margin: 0 },
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
  flat: { margin: 0 },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  mono: { fontFamily: fonts.mono, fontSize: fontSize.small },
  link: {
    color: colors.accentText,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  question: {
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "inherit",
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    color: colors.textPrimary,
  },
  pre: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.md,
    backgroundColor: colors.bgInset,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: fontSize.small,
    lineHeight: lineHeight.relaxed,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  log: { maxHeight: 480, overflowY: "auto" },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  event: { display: "grid", gridTemplateColumns: "104px minmax(0, 1fr)", columnGap: space.s4 },
  eventTime: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
  eventBody: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  eventDetail: { color: colors.textSecondary, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  others: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
});
