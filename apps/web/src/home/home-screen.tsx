import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  CapacityBar,
  Card,
  Field,
  GroupHeader,
  Input,
  MascotMessage,
  Popover,
  ProblemCallout,
  Row,
  Section,
  StatusDot,
  StatusPill,
  Text,
  textStyles,
} from "@factory/ui";
import type { PillStatus } from "@factory/ui";
import type { RunId } from "@factory/core";
import { space } from "@factory/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useStatusName } from "../status";
import type {
  DashboardRunner,
  DoneRun,
  HomePage,
  HomeRun,
  InputWait,
  TodoGroup,
  TodoGroupKind,
} from "./model";
import { runnerIssues, todoGroups } from "./model";
import { subjectParticle } from "./particle";
import { QuestionForm } from "./question-form";
import type { Question, SendState } from "./question-form";

export { QuestionForm } from "./question-form";

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

type Permission = Extract<InputWait, { kind: "permission" }>;

export const STOPPED_VISIBLE = 3;

const SIDE_COLUMN_WIDTH = 340;
const TODO_TEXT_MIN_WIDTH = "16rem";
const ONE_COLUMN = "@container (max-width: 719px)";
const NARROW_SCREEN = "@media (max-width: 600px)";

export function HomeScreen({ page, onAnswer, onDeny }: HomeScreenProps) {
  const t = useTranslations("home");
  if (page.workspace.kind === "none") {
    return (
      <div {...stylex.props(styles.page)}>
        <header {...stylex.props(styles.header)}>
          <Text variant="label" as="p">
            {t("title")}
          </Text>
          <Text variant="display" as="h1">
            {t("headlineEmpty")}
          </Text>
          <Text variant="body">{t("noWorkspace")}</Text>
        </header>
      </div>
    );
  }
  const all = page.workspace.kind === "all";
  const groups = todoGroups(page.attention);
  return (
    <div {...stylex.props(styles.page)}>
      <DashboardHeader page={page} groups={groups} all={all} />
      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.columns)}>
          <div {...stylex.props(styles.mainColumn)}>
            <TodoSection
              groups={groups}
              total={page.attention.length}
              all={all}
              onAnswer={onAnswer}
              onDeny={onDeny}
            />
            <InProgressSection page={page} all={all} />
          </div>
          <div {...stylex.props(styles.sideColumn)}>
            <RunnersSection runners={page.runners.list} />
            <DoneTodaySection page={page} all={all} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardHeader({
  page,
  groups,
  all,
}: {
  page: HomePage;
  groups: TodoGroup[];
  all: boolean;
}) {
  const t = useTranslations("home");
  const total = page.attention.length;
  const inProgress = page.running.length + page.queued.length;
  const summary =
    total === 0
      ? inProgress === 0
        ? t("summary.idle")
        : t("summary.inProgress", { count: inProgress })
      : t("summary.sentence", {
          list: groups
            .map((group) => t(`summary.${group.kind}`, { count: group.runs.length }))
            .join(t("summary.separator")),
        });
  return (
    <header {...stylex.props(styles.header)}>
      <Text variant="label" as="p">
        {all ? `${t("title")} · ${t("allWorkspaces")}` : t("title")}
      </Text>
      <Text variant="display" as="h1">
        {total === 0 ? t("headlineEmpty") : t("headline", { count: total })}
      </Text>
      <Text variant="body">{summary}</Text>
    </header>
  );
}

function TodoSection({
  groups,
  total,
  all,
  onAnswer,
  onDeny,
}: {
  groups: TodoGroup[];
  total: number;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home");
  return (
    <Card label={t("section.todo")}>
      <Section title={t("section.todo")} titleRole="heading" count={total}>
        {groups.length === 0 ? (
          <MascotMessage mood="resting" size="small">
            <Text variant="meta" as="p">
              {t("empty.todo")}
            </Text>
          </MascotMessage>
        ) : (
          <div {...stylex.props(styles.groups)}>
            {groups.map((group) => (
              <TodoGroupBlock
                key={group.kind}
                group={group}
                all={all}
                onAnswer={onAnswer}
                onDeny={onDeny}
              />
            ))}
          </div>
        )}
      </Section>
    </Card>
  );
}

const GROUP_STATUS: Record<TodoGroupKind, PillStatus> = {
  answer: "question",
  check: "human-check",
  stopped: "failed",
};

function TodoGroupBlock({
  group,
  all,
  onAnswer,
  onDeny,
}: {
  group: TodoGroup;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home.group");
  const [expanded, setExpanded] = useState(false);
  const firstHiddenRef = useRef<HTMLLIElement>(null);
  const focusFirstHidden = useRef(false);
  useEffect(() => {
    if (!expanded || !focusFirstHidden.current) return;
    focusFirstHidden.current = false;
    firstHiddenRef.current?.querySelector("a")?.focus();
  }, [expanded]);
  const limited = group.kind === "stopped" && !expanded;
  const visible = limited ? group.runs.slice(0, STOPPED_VISIBLE) : group.runs;
  const hidden = group.runs.length - visible.length;
  return (
    <div data-group={group.kind} {...stylex.props(styles.group)}>
      <GroupHeader
        status={GROUP_STATUS[group.kind]}
        title={t(`${group.kind}.title`)}
        count={group.runs.length}
        description={t(`${group.kind}.description`)}
      />
      <ul {...stylex.props(styles.rows)}>
        {visible.map((run, index) => (
          <TodoRow
            key={run.id}
            run={run}
            all={all}
            onAnswer={onAnswer}
            onDeny={onDeny}
            itemRef={index === STOPPED_VISIBLE ? firstHiddenRef : undefined}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              focusFirstHidden.current = true;
              setExpanded(true);
            }}
          >
            {t("more", { count: hidden })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunKey({ run, all }: { run: HomeRun | DoneRun; all: boolean }) {
  return (
    <span {...stylex.props(styles.keyLine)}>
      <Text variant="title" numeric>
        {run.ticketKey}
      </Text>
      {all ? <Text variant="meta">{run.workspace.name}</Text> : null}
    </span>
  );
}

function TodoRow({
  run,
  all,
  onAnswer,
  onDeny,
  itemRef,
}: {
  run: HomeRun;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
  itemRef: RefObject<HTMLLIElement | null> | undefined;
}) {
  const t = useTranslations("home.row");
  const { ago, duration, elapsed } = useTime();
  const line = (detail: ReactNode, trailing?: string, action?: ReactNode) => (
    <li data-run={run.id} ref={itemRef} {...stylex.props(styles.todoItem)}>
      <span {...stylex.props(styles.todoLink)}>
        <Row href={runHref(run)} {...(trailing === undefined ? {} : { trailing })}>
          <span {...stylex.props(styles.todoBody)}>
            <span {...stylex.props(styles.keyLine)}>
              <RunKey run={run} all={all} />
              {run.cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
            </span>
            <Text variant="ui">{detail}</Text>
          </span>
        </Row>
      </span>
      {action === undefined ? null : <span {...stylex.props(styles.todoAction)}>{action}</span>}
    </li>
  );
  switch (run.state) {
    case "waiting-for-input": {
      const since = run.waitingMs === null ? undefined : elapsed(run.waitingMs);
      const input = run.input;
      if (input === null) return line(t("inputUnknown"), since);
      switch (input.kind) {
        case "question":
          return line(
            input.body,
            since,
            <QuestionAction run={run} question={input} onAnswer={onAnswer} />,
          );
        case "permission":
          return line(
            t("permission", { command: input.detail }),
            since,
            <PermissionAction run={run} permission={input} onDeny={onDeny} />,
          );
      }
      return null;
    }
    case "disconnected": {
      const runner = run.runner?.name ?? t("noRunner");
      return line(
        run.unreachableMs === null
          ? t("unreachable", { runner })
          : t("unreachableFor", { runner, duration: duration(run.unreachableMs) }),
      );
    }
    case "ended": {
      if (run.summary !== "human-check")
        return line(t("failedAt", { time: ago(run.endedAt, run.endedAgoMs) }));
      const pr = run.pullRequest;
      if (pr === null) return line(t("humanCheckNoPr"));
      return line(
        t("pullRequest", { pr: pr.displayId }),
        undefined,
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

function InProgressSection({ page, all }: { page: HomePage; all: boolean }) {
  const t = useTranslations("home");
  const runs = [...page.running, ...page.queued];
  return (
    <Card surface="plain" label={t("section.inProgress")}>
      <Section
        title={t("section.inProgress")}
        titleRole="heading"
        count={runs.length}
        link={{ href: runsHref(page), label: t("inProgress.link") }}
      >
        {runs.length === 0 ? (
          <Text variant="meta" as="p">
            {t("empty.inProgress")}
          </Text>
        ) : (
          <ul {...stylex.props(styles.rows)}>
            {runs.map((run) => (
              <ProgressRow key={run.id} run={run} all={all} />
            ))}
          </ul>
        )}
      </Section>
    </Card>
  );
}

function ProgressRow({ run, all }: { run: HomeRun; all: boolean }) {
  const t = useTranslations("home.row");
  const tDomain = useTranslations("domain");
  const statusName = useStatusName();
  const { elapsed } = useTime();
  const item = (status: PillStatus, detail: string | undefined, since: number | null) => (
    <li data-run={run.id}>
      <Row
        href={runHref(run)}
        leading={<StatusDot status={status}>{statusName(status)}</StatusDot>}
        {...(since === null ? {} : { trailing: elapsed(since) })}
      >
        <span {...stylex.props(styles.keyLine)}>
          <RunKey run={run} all={all} />
          {detail === undefined ? null : (
            <Text variant="meta" truncate>
              {detail}
            </Text>
          )}
          {run.cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
        </span>
      </Row>
    </li>
  );
  switch (run.state) {
    case "running":
      return item("running", run.runner?.name, run.executionMs);
    case "queued": {
      const reason = run.queuedReason;
      switch (reason.kind) {
        case "behind":
        case "no-capacity":
          return item("queued", t("queuedFree"), run.waitMs);
        case "runner-offline":
          return item(
            "queued",
            run.runner === null
              ? t("queuedAnyOffline")
              : t("queuedOffline", {
                  runner: run.runner.name,
                  subject: subjectParticle(run.runner.name),
                }),
            run.waitMs,
          );
        case "starting":
        case "project-missing":
        case "assignment-blocked":
          return item("queued", tDomain(`queuedReason.${reason.kind}`), run.waitMs);
      }
      return null;
    }
    case "waiting-for-input":
    case "disconnected":
    case "ended":
      return null;
  }
}

function RunnersSection({ runners }: { runners: DashboardRunner[] }) {
  const t = useTranslations("home");
  const issues = runnerIssues({ list: runners });
  const names = (cause: "offline" | "auth") =>
    issues.filter((runner) => runner.cause === cause).map((runner) => runner.name);
  const offline = names("offline");
  const auth = names("auth");
  return (
    <Card surface="plain" label={t("section.runners")}>
      <Section title={t("section.runners")} titleRole="subheading" count={runners.length}>
        {runners.length === 0 ? (
          <Text variant="meta" as="p">
            {t("empty.runners")}
          </Text>
        ) : (
          <div {...stylex.props(styles.sideBlock)}>
            <ul {...stylex.props(styles.rows)}>
              {runners.map((runner) => (
                <RunnerRow key={runner.id} runner={runner} />
              ))}
            </ul>
            {issues.length === 0 ? null : (
              <ProblemCallout
                title={t("runners.problemTitle", { count: issues.length })}
                actions={
                  <a
                    href="/runners"
                    data-variant="secondary"
                    {...stylex.props(...buttonStyles("secondary"))}
                  >
                    {t("runners.fix")}
                  </a>
                }
              >
                {offline.length === 0 ? null : (
                  <p {...stylex.props(styles.reset)}>
                    {t("runners.offline", { names: offline.join(", ") })}
                  </p>
                )}
                {auth.length === 0 ? null : (
                  <p {...stylex.props(styles.reset)}>
                    {t("runners.auth", { names: auth.join(", ") })}
                  </p>
                )}
              </ProblemCallout>
            )}
          </div>
        )}
      </Section>
    </Card>
  );
}

function runnerStatus(runner: DashboardRunner): PillStatus {
  switch (runner.cause) {
    case null:
      return "online";
    case "offline":
      return "offline";
    case "auth":
      return "runner-issue";
  }
}

function RunnerRow({ runner }: { runner: DashboardRunner }) {
  const t = useTranslations("home.runners");
  const statusName = useStatusName();
  const status = runnerStatus(runner);
  return (
    <li data-runner={runner.id}>
      <Row
        href={href("/runners", { sel: runner.id })}
        leading={<StatusDot status={status}>{statusName(status)}</StatusDot>}
      >
        <span {...stylex.props(styles.runnerLine)}>
          <Text variant="title" truncate>
            {runner.name}
          </Text>
          <CapacityBar
            used={runner.used}
            total={runner.capacity}
            label={t("capacity", { runner: runner.name })}
            tone={runner.cause === null ? "progress" : "problem"}
          />
        </span>
      </Row>
    </li>
  );
}

function DoneTodaySection({ page, all }: { page: HomePage; all: boolean }) {
  const t = useTranslations("home");
  const done = page.doneToday;
  return (
    <Card surface="plain" label={t("section.doneToday")}>
      <Section
        title={t("section.doneToday")}
        titleRole="subheading"
        count={done.total}
        link={{ href: runsHref(page), label: t("doneToday.link") }}
      >
        {done.recent.length === 0 ? (
          <Text variant="meta" as="p">
            {t("empty.doneToday")}
          </Text>
        ) : (
          <ul {...stylex.props(styles.rows)}>
            {done.recent.map((run) => (
              <DoneRow key={run.id} run={run} all={all} />
            ))}
          </ul>
        )}
      </Section>
    </Card>
  );
}

function DoneRow({ run, all }: { run: DoneRun; all: boolean }) {
  const statusName = useStatusName();
  const { ago } = useTime();
  return (
    <li data-run={run.id}>
      <Row
        href={runHref(run)}
        leading={<StatusDot status={run.summary}>{statusName(run.summary)}</StatusDot>}
        trailing={<time dateTime={run.endedAt}>{ago(run.endedAt, run.endedAgoMs)}</time>}
      >
        <span {...stylex.props(styles.keyLine)}>
          <RunKey run={run} all={all} />
          <Text variant="meta">{statusName(run.summary)}</Text>
        </span>
      </Row>
    </li>
  );
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

function useLayer(onOpen: () => void = () => {}) {
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
      if (next) onOpen();
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
    <span
      ref={resultRef}
      role="status"
      tabIndex={-1}
      {...stylex.props(textStyles("ui"), styles.result)}
    >
      {children}
    </span>
  );
}

function LayerTitle({ run, status, since }: { run: HomeRun; status: PillStatus; since: string }) {
  const statusName = useStatusName();
  return (
    <>
      <StatusPill status={status}>{statusName(status)}</StatusPill>
      <Text variant="meta" numeric>
        {run.ticketKey}
      </Text>
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
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const layer = useLayer(() => setState("idle"));
  const result = useResultFocus(permission.denied);
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
        <Text variant="section" as="p">
          {permission.detail}
        </Text>
        <Field
          label={t("permission.reasonLabel")}
          description={t("permission.reasonDescription")}
          error={state === "failed" ? t("permission.failed") : undefined}
        >
          <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
        </Field>
        <div {...stylex.props(styles.layerFoot)}>
          <Button variant="danger" type="submit" disabled={sending}>
            {sending ? t("permission.denying") : t("permission.send")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function runsHref(page: HomePage): string {
  return page.workspace.kind === "one"
    ? href("/runs", { ws: page.workspace.workspace.id })
    : "/runs";
}

export function runHref(run: { id: RunId; workspace: { id: string } }): string {
  return href(`/runs/${encodeURIComponent(run.id)}`, { ws: run.workspace.id });
}

function href(path: string, search: Record<string, string>): string {
  return `${path}?${new URLSearchParams(search).toString()}`;
}

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: { default: space.s8, [NARROW_SCREEN]: space.s4 },
    paddingBottom: space.s10,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    marginBottom: space.s8,
  },
  frame: { containerType: "inline-size" },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${SIDE_COLUMN_WIDTH}px`,
      [ONE_COLUMN]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    columnGap: space.s8,
    rowGap: space.s10,
  },
  mainColumn: { display: "flex", flexDirection: "column", gap: space.s10, minWidth: 0 },
  sideColumn: { display: "flex", flexDirection: "column", gap: space.s10, minWidth: 0 },
  sideBlock: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  groups: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  rows: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  todoItem: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    minWidth: 0,
  },
  todoLink: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: `min(100%, ${TODO_TEXT_MIN_WIDTH})`,
  },
  todoAction: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    maxWidth: "100%",
    paddingInline: { default: 0, [ONE_COLUMN]: space.s3 },
  },
  todoBody: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  keyLine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.s2,
    minWidth: 0,
  },
  runnerLine: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
  },
  reset: { margin: 0 },
  result: { flexShrink: 1, minWidth: 0, outline: "none" },
  layerForm: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  layerFoot: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
});
