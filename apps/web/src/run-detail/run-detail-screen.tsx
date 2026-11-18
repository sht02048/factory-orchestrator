import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
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
} from "@factory/ui";
import type { PillStatus } from "@factory/ui";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "@factory/ui/tokens.stylex";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { runStatus, useStatusName } from "../status";
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

/**
 * Run 상세: 전체 화면(ADR 0010). 위에 상태·제목·행동, 그 아래 왼쪽은 질문 카드·지나온 일,
 * 오른쪽은 런 정보·터미널 끝부분·같은 티켓의 다른 런.
 */
export function RunDetailScreen(props: RunDetailScreenProps) {
  const { page } = props;
  if (page.kind === "not-found") return <NotFound runsHref={props.runsHref} />;
  return <Main {...props} run={page.run} />;
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
  const statusLine = useStatusLine();
  const statusName = useStatusName();
  const { status, when } = statusLine(run);
  const pr = run.pullRequest;
  const cancelable = canCancel(run) && !run.cancelPending;

  return (
    <div {...stylex.props(styles.main)}>
      <nav aria-label={t("crumb.label")} {...stylex.props(styles.crumb)}>
        <a href={props.runsHref} {...stylex.props(styles.crumbLink)}>
          <span aria-hidden="true">‹</span>
          {t("crumb.runs")}
        </a>
      </nav>

      <header {...stylex.props(styles.head)}>
        <p {...stylex.props(styles.stateLine)}>
          <StatusPill status={status}>{statusName(status)}</StatusPill>
          <Text variant="meta">{when}</Text>
          {run.cancelPending ? <Text variant="meta">{t("cancelPending")}</Text> : null}
        </p>
        <div {...stylex.props(styles.titleRow)}>
          {/* 티켓 제목을 저장하면 회색 키 + 제목으로 바꾼다(ADR 0010 9번). 지금은 키만 있다. */}
          <Text variant="page" as="h1">
            {run.ticketKey}
          </Text>
          {pr === null && !cancelable ? null : (
            <Actions>
              {pr === null ? null : (
                <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
                  {t("openPr", { pr: pr.displayId })}
                </a>
              )}
              {cancelable ? <CancelRun onCancel={props.onCancel} /> : null}
            </Actions>
          )}
        </div>
        <Text variant="meta">
          {run.branch === null ? run.trackerProject : `${run.trackerProject} · ${run.branch}`}
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
            />
          ) : null}

          {run.startError === null ? null : (
            <Block title={t("startError.title")}>
              <Text variant="body">{t("startError.body")}</Text>
              <pre {...stylex.props(styles.pre)}>{run.startError}</pre>
            </Block>
          )}

          {run.status.state === "ended" ? (
            <Block title={t("report.title")}>
              {run.report === null ? (
                <Text variant="meta">{t("report.none")}</Text>
              ) : (
                <pre {...stylex.props(styles.pre)}>{run.report}</pre>
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

/** 이름 붙은 카드 하나. 제목 줄 오른쪽에 흐린 값이나 행동을 둘 수 있다 */
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
        <Text variant="section" as="h2">
          {title}
        </Text>
        {aside === undefined ? null : aside}
      </div>
      {children}
    </Card>
  );
}

/** 지금 기다리는 질문·권한 요청이 들어온 때부터 서버가 읽은 때까지. 타임라인의 마지막 그 일로 잰다 */
function inputWaitedMs(run: RunDetail): number | null {
  if (run.status.state !== "waiting-for-input") return null;
  const kind = run.status.input.kind;
  if (kind === "unknown") return null;
  const last = run.timeline.findLast((event) => event.kind === kind);
  return last === undefined ? null : Math.max(0, Date.parse(run.now) - Date.parse(last.at));
}

function Reason({ run }: { run: RunDetail }) {
  const t = useTranslations("run.reason");
  const domain = useTranslations("domain");
  const { clock } = useTime();
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
      {/* 사람이 해야 할 문제라 빨강(ADR 0010 5번)으로 띄운다 */}
      <span {...stylex.props(styles.problemNote)}>{t("manualRemoval")}</span>{" "}
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
}: {
  input: PendingInput;
  waitedMs: number | null;
  onAnswer: RunDetailActions["onAnswer"];
  onDeny: RunDetailActions["onDeny"];
}) {
  switch (input.kind) {
    case "question":
      return input.answered ? null : (
        <QuestionForm question={input} waitedMs={waitedMs} onAnswer={onAnswer} />
      );
    case "permission":
      return input.denied ? null : (
        <PermissionWait wait={input} waitedMs={waitedMs} onDeny={onDeny} />
      );
    case "unknown":
      return null;
  }
}

type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed" };

/** 질문 카드의 머리: 종류 알약 + 기다린 시간 */
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
}: {
  question: Extract<PendingInput, { kind: "question" }>;
  waitedMs: number | null;
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
    <Card label={t("question.title")}>
      <InputHead kind="question" waitedMs={waitedMs} />
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
            // 선택지는 모두 같은 보조 버튼이다. 추천처럼 칠하지 않는다(ADR 0010 6번).
            <div role="group" aria-label={t("question.choicesLabel")}>
              <Actions>
                {question.choices.map((choice) => (
                  <Button
                    key={choice}
                    variant="secondary"
                    disabled={submit.kind === "sending"}
                    onClick={() => send(choice)}
                  >
                    {choice}
                  </Button>
                ))}
              </Actions>
            </div>
          )}
          <div {...stylex.props(styles.answerRow)}>
            <div {...stylex.props(styles.grow)}>
              <Field
                label={t("question.answerLabel")}
                description={t("question.answerHelp")}
                {...(empty ? { error: t("question.empty") } : {})}
              >
                <Input name="answer" value={answer} onValueChange={setAnswer} autoComplete="off" />
              </Field>
            </div>
            {/* 화면의 주 행동 하나(ADR 0010 6번). 라벨 줄만큼 내려 입력칸과 줄을 맞춘다 */}
            <div {...stylex.props(styles.submitOffset)}>
              <Button type="submit" variant="primary" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("question.submitting") : t("question.submit")}
              </Button>
            </div>
          </div>
          {submit.kind === "failed" ? <Text variant="body">{t("actionFailed")}</Text> : null}
        </form>
      )}
    </Card>
  );
}

function PermissionWait({
  wait,
  waitedMs,
  onDeny,
}: {
  wait: Extract<PendingInput, { kind: "permission" }>;
  waitedMs: number | null;
  onDeny: RunDetailActions["onDeny"];
}) {
  const t = useTranslations("run");
  const [reason, setReason] = useState("");
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  return (
    <Card label={t("permission.title")}>
      <InputHead kind="permission" waitedMs={waitedMs} />
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
              <Button type="submit" variant="danger" disabled={submit.kind === "sending"}>
                {submit.kind === "sending" ? t("permission.denying") : t("permission.deny")}
              </Button>
            </Actions>
          </form>
        )}
        {submit.kind === "failed" ? <Text variant="body">{t("actionFailed")}</Text> : null}
      </div>
    </Card>
  );
}

function CancelRun({ onCancel }: { onCancel: RunDetailActions["onCancel"] }) {
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

function Timeline({ events, now }: { events: ReadonlyArray<TimelineEvent>; now: string }) {
  const t = useTranslations("run.timeline");
  const domain = useTranslations("domain");
  const laterPr = useTranslations("run.laterPr");
  const { stamp } = useTime();
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
    <Block title={t("title")} compact>
      <ol {...stylex.props(styles.timeline)}>
        {events.map((event, index) => {
          const detail = eventDetail(event);
          return (
            <li key={`${event.kind}-${index}`}>
              <Row
                trailing={
                  <time dateTime={event.at} {...stylex.props(styles.eventTime)}>
                    {stamp(event.at, now)}
                  </time>
                }
              >
                <span {...stylex.props(styles.eventBody)}>
                  <span {...stylex.props(styles.eventTitle)}>{t(event.kind)}</span>
                  {detail === null ? null : (
                    <span {...stylex.props(styles.eventDetail)}>{detail}</span>
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
  onRefresh: () => void;
}) {
  const t = useTranslations("run.log");
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
  // 기다리는 중에도 다시 요청할 수 있게 둔다. worker 가 늦으면 화면이 다시 읽기를 멈춘다.
  const live = log.kind !== "none" && log.kind !== "stored";
  return (
    <Block
      title={t("title")}
      aside={
        live ? (
          <Button variant="ghost" onClick={onRefresh}>
            {t("refresh")}
          </Button>
        ) : undefined
      }
    >
      {note === undefined ? null : <Text variant="meta">{note}</Text>}
      {body}
    </Block>
  );
}

function LogLines({ lines }: { lines: ReadonlyArray<string> }) {
  const t = useTranslations("run.log");
  if (lines.length === 0) return <Text variant="meta">{t("empty")}</Text>;
  return <pre {...stylex.props(styles.pre, styles.log)}>{lines.join("\n")}</pre>;
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
            <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
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
            <span {...stylex.props(styles.mono)}>{run.branch}</span>
          </DefinitionItem>
        )}
        {run.worktree === null ? null : (
          <DefinitionItem label={t("worktree")}>
            <span {...stylex.props(styles.mono)}>{run.worktree}</span>
          </DefinitionItem>
        )}
      </DefinitionList>
    </Card>
  );
}

/** 같은 티켓의 다른 런: 할당한 때 + 상태 알약 */
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
                <a href={runHref(o.id)} {...stylex.props(styles.link)}>
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

/** 상태 줄: Ended 는 요약 결과, 그 밖은 런 상태 */
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
    gap: space.s6,
    maxWidth: 1280,
    paddingTop: space.s6,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  crumb: { display: "flex", fontSize: fontSize.ui },
  crumbLink: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: space.s2,
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
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
  // 왼쪽 질문·지나온 일, 오른쪽 정보·터미널 끝부분. 좁으면 한 열로 쌓는다.
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 360px",
      "@media (max-width: 960px)": "minmax(0, 1fr)",
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
  // 행을 담는 카드는 안쪽 여백이 좁아 제목만 행 글과 줄을 맞춘다.
  blockHeadCompact: { paddingTop: space.s2, paddingInline: space.s3, paddingBottom: space.s1 },
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
  flat: { margin: 0 },
  problemNote: { color: colors.problem, fontWeight: fontWeight.semibold },
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
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    color: colors.textPrimary,
  },
  answerRow: { display: "flex", alignItems: "flex-start", gap: space.s2 },
  grow: { flexGrow: 1, minWidth: 0 },
  // Field 라벨 줄(글 + px6 틈)과 입력칸·버튼 높이 차이만큼
  submitOffset: { flexShrink: 0, paddingTop: 28 },
  pre: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.control,
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
    gap: space.px2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  eventTime: { fontSize: fontSize.ui },
  eventBody: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  eventTitle: { color: colors.textPrimary },
  eventDetail: {
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
