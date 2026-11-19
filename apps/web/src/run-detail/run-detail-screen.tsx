import * as stylex from "@stylexjs/stylex";
import { isMcpRejectReason, isMcpRunTool } from "@ganger/app/mcp/actions";
import {
  Actions,
  Button,
  Card,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  Input,
  PageHeader,
  Row,
  StatusPill,
  Text,
  focusStyles,
  linkStyles,
  NoticeLayout,
  textStyles,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { QuestionAnswer } from "../question/question-answer";
import { useAgentName, useQueuedReasonText } from "../labels";
import { runStatus, useStatusName } from "../status";
import { canCancel } from "@ganger/app/run-detail/model";
import type {
  LogTailView,
  PendingInput,
  RunDetail,
  RunDetailPage,
  TimelineEvent,
} from "@ganger/app/run-detail/model";

export interface RunDetailActions {
  onAnswer: (questionId: string, body: string) => Promise<void>;
  onDeny: (promptId: string, reason: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRefreshLog: () => Promise<void>;
}

export interface RunDetailScreenProps extends RunDetailActions {
  page: RunDetailPage;
  runsHref: string;
  runHref: (runId: string) => string;
}

export function RunDetailScreen(props: RunDetailScreenProps) {
  const { page } = props;
  if (page.kind === "not-found") return <NotFound runsHref={props.runsHref} />;
  return <Main {...props} run={page.run} />;
}

function NotFound({ runsHref }: { runsHref: string }) {
  const t = useTranslations("run.notFound");
  return (
    <NoticeLayout>
      <PageHeader title={t("title")} />
      <div {...stylex.props(styles.noticeBody)}>
        <Text variant="body">{t("body")}</Text>
        <a href={runsHref} {...stylex.props(linkStyles())}>
          {t("back")}
        </a>
      </div>
    </NoticeLayout>
  );
}

function Main(props: RunDetailScreenProps & { run: RunDetail }) {
  const { run } = props;
  const t = useTranslations("run");
  const statusLine = useStatusLine();
  const statusName = useStatusName();
  const { status, when } = statusLine(run);
  const pr = run.pullRequest;
  const cancelable = canCancel(run) && !run.cancelPending;
  const headRef = useRef<HTMLElement>(null);
  const cancelStatusRef = useRef<HTMLSpanElement>(null);

  return (
    <div {...stylex.props(styles.main)}>
      <nav aria-label={t("crumb.label")} {...stylex.props(textStyles("ui"), styles.crumb)}>
        <a href={props.runsHref} {...stylex.props(linkStyles("quiet"), styles.crumbLink)}>
          <span aria-hidden="true">‹</span>
          {t("crumb.runs")}
        </a>
      </nav>

      <header ref={headRef} tabIndex={-1} {...stylex.props(styles.head, focusStyles.target)}>
        <p {...stylex.props(styles.stateLine)}>
          <StatusPill status={status}>{statusName(status)}</StatusPill>
          <Text variant="meta">{when}</Text>
          <Text variant="meta" ref={cancelStatusRef} role="status" tabIndex={-1}>
            {run.cancelPending ? t("cancelPending") : null}
          </Text>
        </p>
        <div {...stylex.props(styles.titleRow)}>
          <Text variant="page" as="h1">
            {run.ticketTitle ?? run.ticketKey}
          </Text>
          {pr === null && !cancelable ? null : (
            <Actions>
              {pr === null ? null : (
                <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(linkStyles())}>
                  {t("openPr", { pr: pr.displayId })}
                </a>
              )}
              {cancelable ? (
                <CancelRun
                  onCancel={props.onCancel}
                  focusAfter={() => focusFirst(cancelStatusRef, headRef)}
                />
              ) : null}
            </Actions>
          )}
        </div>
        <Text variant="meta">
          {[
            ...(run.ticketTitle === null ? [] : [run.ticketKey]),
            run.trackerProject,
            ...(run.branch === null ? [] : [run.branch]),
          ].join(t("metaSeparator"))}
        </Text>
        <Text variant="body">
          <Reason run={run} />
        </Text>
        <NextAction run={run} />
      </header>

      <div {...stylex.props(styles.columns)}>
        <div {...stylex.props(styles.column)}>
          {run.status.state === "waiting-for-input" ? (
            <InputBlock
              input={run.status.input}
              waitedMs={inputWaitedMs(run)}
              onAnswer={props.onAnswer}
              onDeny={props.onDeny}
              headRef={headRef}
            />
          ) : null}

          {run.startError === null ? null : (
            <Block title={t("startError.title")}>
              <Text variant="body">{t("startError.body")}</Text>
              <CodeBlock>{run.startError}</CodeBlock>
            </Block>
          )}

          {run.status.state === "ended" ? (
            <Block title={t("report.title")}>
              {run.report === null ? (
                <Text variant="meta">{t("report.none")}</Text>
              ) : (
                <CodeBlock>{run.report}</CodeBlock>
              )}
            </Block>
          ) : null}

          <Timeline events={run.timeline} now={run.now} />
        </div>

        <div {...stylex.props(styles.column)}>
          <Properties run={run} />
          <LogTail log={run.log} now={run.now} onRefresh={props.onRefreshLog} />
          <OtherRuns run={run} runHref={props.runHref} />
        </div>
      </div>
    </div>
  );
}

function Block({
  title,
  aside,
  compact = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <Card label={title} padding={compact ? "compact" : "normal"}>
      <div {...stylex.props(styles.blockHead, compact && styles.blockHeadCompact)}>
        <Text variant="subheading" as="h2">
          {title}
        </Text>
        {aside === undefined ? null : aside}
      </div>
      {children}
    </Card>
  );
}

function focusFirst(...targets: ReadonlyArray<RefObject<HTMLElement | null>>): void {
  for (const target of targets) {
    const element = target.current;
    if (element !== null && element.isConnected) {
      element.focus();
      return;
    }
  }
}

function ActionFailed() {
  const t = useTranslations("run");
  return (
    <Text variant="ui" as="p" tone="problem" role="alert">
      {t("actionFailed")}
    </Text>
  );
}

function inputWaitedMs(run: RunDetail): number | null {
  if (run.status.state !== "waiting-for-input" || run.status.inputSince === null) return null;
  return Math.max(0, Date.parse(run.now) - Date.parse(run.status.inputSince));
}

function Reason({ run }: { run: RunDetail }) {
  const t = useTranslations("run.reason");
  const queuedReasonText = useQueuedReasonText();
  const { clock } = useTime();
  const { status } = run;
  switch (status.state) {
    case "queued":
      return queuedReasonText(status.queuedReason);
    case "running":
      return t("running");
    case "waiting-for-input":
      return t(inputKey(status.input));
    case "disconnected":
      return status.unreachableSince === null
        ? t("disconnected")
        : t("disconnectedSince", { time: clock(status.unreachableSince) });
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
  return manual ? (
    <p {...stylex.props(styles.flat)}>
      <Text variant="title" tone="problem">
        {t("manualRemoval")}
      </Text>{" "}
      <Text variant="body">{t("next.manualRemoval")}</Text>
    </p>
  ) : (
    <Text variant="body">{next}</Text>
  );
}

function InputBlock({
  input,
  waitedMs,
  onAnswer,
  onDeny,
  headRef,
}: {
  input: PendingInput;
  waitedMs: number | null;
  onAnswer: RunDetailActions["onAnswer"];
  onDeny: RunDetailActions["onDeny"];
  headRef: RefObject<HTMLElement | null>;
}) {
  switch (input.kind) {
    case "question":
      return (
        <QuestionForm
          key={input.questionId}
          question={input}
          waitedMs={waitedMs}
          onAnswer={onAnswer}
          headRef={headRef}
        />
      );
    case "permission":
      return (
        <PermissionWait
          key={input.promptId}
          wait={input}
          waitedMs={waitedMs}
          onDeny={onDeny}
          headRef={headRef}
        />
      );
    case "unknown":
      return null;
  }
}

function useSubmit(headRef: RefObject<HTMLElement | null>) {
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  const resultRef = useRef<HTMLParagraphElement>(null);
  const run = (send: () => Promise<void>): Promise<void> => {
    setSubmit({ kind: "sending" });
    const sent = send();
    sent.then(
      () => {
        setSubmit({ kind: "sent" });
        if (resultRef.current === null || !resultRef.current.isConnected) focusFirst(headRef);
      },
      () => setSubmit({ kind: "failed" }),
    );
    return sent;
  };
  useEffect(() => {
    if (submit.kind === "sent") resultRef.current?.focus();
  }, [submit.kind]);
  return { submit, run, resultRef };
}

type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed" };

function InputHead({
  kind,
  waitedMs,
}: {
  kind: "question" | "permission";
  waitedMs: number | null;
}) {
  const t = useTranslations("run.input");
  const statusName = useStatusName();
  const { elapsed } = useTime();
  return (
    <p {...stylex.props(styles.stateLine)}>
      <StatusPill status={kind}>{statusName(kind)}</StatusPill>
      {waitedMs === null ? null : (
        <Text variant="meta">{t(kind, { elapsed: elapsed(waitedMs) })}</Text>
      )}
    </p>
  );
}

function QuestionForm({
  question,
  waitedMs,
  onAnswer,
  headRef,
}: {
  question: Extract<PendingInput, { kind: "question" }>;
  waitedMs: number | null;
  onAnswer: RunDetailActions["onAnswer"];
  headRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run");
  const { submit, run, resultRef } = useSubmit(headRef);
  return (
    <Card label={t("question.title")}>
      <InputHead kind="question" waitedMs={waitedMs} />
      {submit.kind === "sent" || question.answered ? (
        <>
          <Text variant="body" as="p" wrap="pre">
            {question.body}
          </Text>
          <Text variant="body" as="p" ref={resultRef} role="status" tabIndex={-1}>
            {t("question.sent")}
          </Text>
        </>
      ) : (
        <QuestionAnswer
          body={question.body}
          options={question.choices}
          onSend={(answer) => run(() => onAnswer(question.questionId, answer))}
        />
      )}
    </Card>
  );
}

function PermissionWait({
  wait,
  waitedMs,
  onDeny,
  headRef,
}: {
  wait: Extract<PendingInput, { kind: "permission" }>;
  waitedMs: number | null;
  onDeny: RunDetailActions["onDeny"];
  headRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("run");
  const [reason, setReason] = useState("");
  const { submit, run, resultRef } = useSubmit(headRef);
  return (
    <Card label={t("permission.title")}>
      <InputHead kind="permission" waitedMs={waitedMs} />
      <div {...stylex.props(styles.stack)}>
        <Text variant="panel" as="p" wrap="pre">
          {wait.detail}
        </Text>
        {submit.kind === "sent" || wait.denied ? (
          <Text variant="body" as="p" ref={resultRef} role="status" tabIndex={-1}>
            {t("permission.denied")}
          </Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => onDeny(wait.promptId, reason));
            }}
          >
            <Text variant="body">{t("permission.body")}</Text>
            <Field label={t("permission.reasonLabel")} description={t("permission.reasonHelp")}>
              <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
            </Field>
            <Actions>
              <Button type="submit" variant="danger" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("permission.denying") : t("permission.deny")}
              </Button>
            </Actions>
          </form>
        )}
        {submit.kind === "failed" ? <ActionFailed /> : null}
      </div>
    </Card>
  );
}

function CancelRun({
  onCancel,
  focusAfter,
}: {
  onCancel: RunDetailActions["onCancel"];
  focusAfter: () => void;
}) {
  const t = useTranslations("run");
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Dialog
        trigger={t("cancel.trigger")}
        triggerVariant="danger"
        title={t("cancel.title")}
        description={t("cancel.body")}
        actions={
          <>
            <DialogClose>{t("cancel.dismiss")}</DialogClose>
            <DialogClose
              variant="danger"
              onClick={() => {
                setFailed(false);
                onCancel().then(focusAfter, () => setFailed(true));
              }}
            >
              {t("cancel.confirm")}
            </DialogClose>
          </>
        }
      />
      {failed ? <ActionFailed /> : null}
    </>
  );
}

function Timeline({ events, now }: { events: ReadonlyArray<TimelineEvent>; now: string }) {
  const t = useTranslations("run.timeline");
  const domain = useTranslations("domain");
  const laterPr = useTranslations("run.laterPr");
  const { stamp } = useTime();
  const toolName = (tool: string): string => (isMcpRunTool(tool) ? t(`mcpTool.${tool}`) : tool);
  const eventTitle = (event: TimelineEvent): string =>
    event.kind === "mcp" ? t("mcp", { client: event.client }) : t(event.kind);
  const eventDetail = (event: TimelineEvent): string | null => {
    switch (event.kind) {
      case "mcp":
        if (event.outcome === "done") return toolName(event.tool);
        return isMcpRejectReason(event.reason)
          ? t("mcpRejected", {
              tool: toolName(event.tool),
              reason: t(`mcpReason.${event.reason}`),
            })
          : t("mcpRejectedUnknown", { tool: toolName(event.tool) });
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
    <Block title={t("title")} compact>
      <ol {...stylex.props(styles.timeline)}>
        {events.map((event, index) => {
          const detail = eventDetail(event);
          return (
            <li key={`${event.kind}-${index}`}>
              <Row
                trailing={
                  <time dateTime={event.at} {...stylex.props(textStyles("meta"))}>
                    {stamp(event.at, now)}
                  </time>
                }
              >
                <span {...stylex.props(styles.eventBody)}>
                  <Text variant="ui" tone="strong">
                    {eventTitle(event)}
                  </Text>
                  {detail === null ? null : (
                    <Text variant="meta" wrap="pre">
                      {detail}
                    </Text>
                  )}
                </span>
              </Row>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

function LogTail({
  log,
  now,
  onRefresh,
}: {
  log: LogTailView;
  now: string;
  onRefresh: RunDetailActions["onRefreshLog"];
}) {
  const t = useTranslations("run.log");
  const [refresh, setRefresh] = useState<"idle" | "refreshing" | "failed">("idle");
  const refreshing = refresh === "refreshing";
  const { ago } = useTime();
  const time = (at: string): string => ago(at, Date.parse(now) - Date.parse(at));
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
  const live = log.kind !== "none" && log.kind !== "stored";
  return (
    <Block
      title={t("title")}
      aside={
        live ? (
          <Button
            variant="ghost"
            aria-disabled={refreshing}
            onClick={() => {
              if (refreshing) return;
              setRefresh("refreshing");
              onRefresh().then(
                () => setRefresh("idle"),
                () => setRefresh("failed"),
              );
            }}
          >
            {refreshing ? t("refreshing") : t("refresh")}
          </Button>
        ) : undefined
      }
    >
      {note === undefined ? null : <Text variant="meta">{note}</Text>}
      {body}
      {refresh === "failed" ? (
        <Text variant="ui" as="p" tone="problem" role="alert">
          {t("refreshFailed")}
        </Text>
      ) : null}
    </Block>
  );
}

function LogLines({ lines }: { lines: ReadonlyArray<string> }) {
  const t = useTranslations("run.log");
  const ref = useRef<HTMLPreElement>(null);
  const text = lines.join("\n");
  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [text]);
  if (lines.length === 0) return <Text variant="meta">{t("empty")}</Text>;
  return (
    <CodeBlock ref={ref} scroll label={t("linesLabel")}>
      {text}
    </CodeBlock>
  );
}

function Properties({ run }: { run: RunDetail }) {
  const agentName = useAgentName();
  const t = useTranslations("run.props");
  const domain = useTranslations("domain");
  const ci = useTranslations("run.ci");
  const laterPr = useTranslations("run.laterPr");
  const { duration, ago, stamp } = useTime();
  const time = (at: string): string => ago(at, Date.parse(run.now) - Date.parse(at));
  const ended = run.status.state === "ended" ? run.status : null;
  const pr = run.pullRequest;

  return (
    <Card label={t("label")}>
      <DefinitionList>
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
        <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
        <DefinitionItem label={t("model")} empty={run.model === null}>
          {run.model ?? t("defaultModel")}
        </DefinitionItem>
        <DefinitionItem label={t("workspace")}>
          <span {...stylex.props(styles.inline)}>
            {run.workspace.name}
            <Text variant="meta">{run.trackerProject}</Text>
          </span>
        </DefinitionItem>
        <DefinitionItem label={t("pr")} empty={pr === null}>
          {pr === null ? (
            t("none")
          ) : (
            <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(linkStyles())}>
              {pr.displayId}
            </a>
          )}
        </DefinitionItem>
        {pr === null ? null : <DefinitionItem label={t("ci")}>{ci(pr.ci)}</DefinitionItem>}
        {ended === null ? null : (
          <>
            <DefinitionItem label={t("agentResult")}>
              {domain(`agentResult.${ended.agentResult}`)}
            </DefinitionItem>
            <DefinitionItem label={t("prState")}>
              {domain(`prState.${ended.prState}`)}
            </DefinitionItem>
            {ended.laterPrState === null ? null : (
              <DefinitionItem label={t("laterPrState")}>
                {t("laterPr", {
                  state: laterPr(ended.laterPrState.state),
                  time: time(ended.laterPrState.at),
                })}
              </DefinitionItem>
            )}
          </>
        )}
        <DefinitionItem label={t("started")} empty={run.startedAt === null}>
          {run.startedAt === null ? t("notStarted") : stamp(run.startedAt, run.now)}
        </DefinitionItem>
        <DefinitionItem label={t("waited")}>{duration(run.waitMs)}</DefinitionItem>
        {run.executionMs === null ? null : (
          <DefinitionItem label={t("executed")}>{duration(run.executionMs)}</DefinitionItem>
        )}
        {run.branch === null ? null : (
          <DefinitionItem label={t("branch")}>
            <Text variant="ui" tone="strong" mono>
              {run.branch}
            </Text>
          </DefinitionItem>
        )}
        {run.worktree === null ? null : (
          <DefinitionItem label={t("worktree")}>
            <Text variant="ui" tone="strong" mono>
              {run.worktree}
            </Text>
          </DefinitionItem>
        )}
      </DefinitionList>
    </Card>
  );
}

function OtherRuns({ run, runHref }: { run: RunDetail; runHref: (runId: string) => string }) {
  const t = useTranslations("run.otherRuns");
  const { ago } = useTime();
  const statusName = useStatusName();
  if (run.otherRuns.length === 0) return null;
  return (
    <Block title={t("title")} compact>
      <ol {...stylex.props(styles.timeline)}>
        {run.otherRuns.map((o) => {
          const status = runStatus(o);
          return (
            <li key={o.id}>
              <Row trailing={<StatusPill status={status}>{statusName(status)}</StatusPill>}>
                <a href={runHref(o.id)} {...stylex.props(linkStyles())}>
                  {ago(o.assignedAt, Date.parse(run.now) - Date.parse(o.assignedAt))}
                </a>
              </Row>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

function useStatusLine(): (run: RunDetail) => { status: PillStatus; when: string } {
  const t = useTranslations("run.when");
  const { duration, elapsed } = useTime();
  return (run) => {
    const { status } = run;
    switch (status.state) {
      case "ended":
        return {
          status: runStatus(status),
          when:
            run.startedAt === null
              ? t("endedBeforeStart", { duration: duration(run.waitMs) })
              : t("endedAfter", { duration: duration(run.executionMs ?? 0) }),
        };
      case "queued":
        return {
          status: runStatus(status),
          when: t("waitingFor", { duration: duration(run.waitMs) }),
        };
      case "running":
      case "waiting-for-input":
      case "disconnected":
        return { status: runStatus(status), when: elapsed(run.executionMs ?? 0) };
    }
  };
}

const styles = stylex.create({
  noticeBody: { display: "flex", flexDirection: "column", gap: space.s4 },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    maxWidth: size.detailPageWidth,
    paddingTop: space.s6,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  crumb: { display: "flex" },
  crumbLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.control,
  },
  head: { display: "flex", flexDirection: "column", gap: space.s2 },
  titleRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s4,
  },
  stateLine: { display: "flex", alignItems: "center", gap: space.s3, margin: 0 },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.detailAsideWidth}`,
      [breakpoints.detailStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s6,
  },
  column: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  blockHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  blockHeadCompact: { paddingTop: space.s2, paddingInline: space.s3, paddingBottom: space.s1 },
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
  flat: { margin: 0 },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  answerRow: { display: "flex", alignItems: "center", gap: space.s2 },
  grow: { flexGrow: 1, minWidth: 0 },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  eventBody: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});
