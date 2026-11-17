import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  Field,
  Input,
  PageHeader,
  PanelBlock,
  PanelFooter,
  PanelHeader,
  RowReason,
  RowTitle,
  Section,
  SplitView,
  Status,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
} from "@factory/ui";
import type { StatusTone } from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import type { SummaryOutcome } from "@factory/core";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useFormatDuration } from "../format/duration";
import { useAgentName } from "../labels";
import type { AttentionItem, BrokenAuthRunner, HomePage, HomeRun, InputWait } from "./model";
import type { QueuedReason } from "../runs/model";
import { attentionKey, runKey } from "./model";

// 손댈 일: 티켓(+이유) | 상태 | 에이전트 결과 | PR 상태 | 러너 | 에이전트 또는 Workspace | 경과
const attentionColumns = "minmax(0, 1fr) 112px 128px 64px 96px 112px 72px";
// 실행 중: 티켓 | 러너 | 에이전트 | 경과
const runningColumns = "minmax(0, 1fr) 96px 80px 72px";
// Queued: 티켓(+이유) | 러너 | 에이전트 | 기다린 시간
const queuedColumns = "minmax(0, 1fr) 96px 80px 88px";

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
  /** 고른 행(attentionKey·runKey). 없거나 목록에 없으면 첫 행을 고른다 */
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
  /** 질문에 답을 남긴다. 실패하면 던진다 */
  onAnswer: (input: AnswerInput) => Promise<void>;
  /** 권한 프롬프트 거절을 남긴다. 실패하면 던진다 */
  onDeny: (input: DenyInput) => Promise<void>;
}

type Selectable = { key: string; item: AttentionItem };

/** 홈: 손댈 일, 실행 중, Queued + 오른쪽 상세 패널(ADR 0007, 시안 B) */
export function HomeScreen(props: HomeScreenProps) {
  const t = useTranslations("home");
  const { page } = props;
  if (page.workspace.kind === "none") {
    return (
      <div {...stylex.props(styles.notice)}>
        <PageHeader title={t("title")} />
        <Text variant="body">{t("noWorkspace")}</Text>
      </div>
    );
  }
  const all = page.workspace.kind === "all";

  const selectable: Selectable[] = [
    ...page.attention.map((item) => ({ key: attentionKey(item), item })),
    ...[...page.running, ...page.queued].map((run) => ({
      key: runKey(run),
      item: { kind: "run", run } satisfies AttentionItem,
    })),
  ];
  const selected = selectable.find((s) => s.key === props.selectedKey) ?? selectable[0];
  const selectedKey = selected?.key ?? null;
  const pick = (keys: ReadonlyArray<string>) =>
    selectedKey !== null && keys.includes(selectedKey) ? selectedKey : null;

  return (
    <SplitView
      list={
        <>
          <PageHeader
            title={t("title")}
            subtitle={
              page.workspace.kind === "all"
                ? t("subtitleAll")
                : t("subtitle", {
                    workspace: page.workspace.workspace.name,
                    running: page.running.length,
                    queued: page.queued.length,
                  })
            }
          />
          <Section title={t("section.attention")} count={page.attention.length}>
            <AttentionTable
              items={page.attention}
              all={all}
              value={pick(page.attention.map(attentionKey))}
              onSelect={props.onSelect}
            />
          </Section>
          {all ? null : (
            <>
              <Section title={t("section.running")} count={page.running.length}>
                <RunningTable
                  runs={page.running}
                  value={pick(page.running.map(runKey))}
                  onSelect={props.onSelect}
                />
              </Section>
              <Section
                title={t("section.queued")}
                count={page.queued.length}
                note={t("section.queuedNote")}
              >
                <QueuedTable
                  runs={page.queued}
                  value={pick(page.queued.map(runKey))}
                  onSelect={props.onSelect}
                />
              </Section>
            </>
          )}
        </>
      }
      panel={
        selected === undefined ? null : (
          <section aria-label={t("panel.label")}>
            {selected.item.kind === "run" ? (
              <RunPanel
                // 고른 런이 바뀌면 답하기 칸을 비운다
                key={selected.key}
                run={selected.item.run}
                onAnswer={props.onAnswer}
                onDeny={props.onDeny}
              />
            ) : (
              <RunnerAuthPanel runner={selected.item.runner} />
            )}
          </section>
        )
      }
    />
  );
}

// ---------- 목록 ----------

function AttentionTable({
  items,
  all,
  value,
  onSelect,
}: {
  items: ReadonlyArray<AttentionItem>;
  all: boolean;
  value: string | null;
  onSelect: (key: string) => void;
}) {
  const t = useTranslations("home");
  return (
    <Table columns={attentionColumns}>
      <TableHead>
        <TableHeader>{t("columns.ticket")}</TableHeader>
        <TableHeader>{t("columns.state")}</TableHeader>
        <TableHeader>{t("columns.agentResult")}</TableHeader>
        <TableHeader>{t("columns.prState")}</TableHeader>
        <TableHeader>{t("columns.runner")}</TableHeader>
        <TableHeader>{all ? t("columns.workspace") : t("columns.agent")}</TableHeader>
        <TableHeader align="end">{t("columns.elapsed")}</TableHeader>
      </TableHead>
      {items.length === 0 ? (
        <TableEmpty>{t("empty.attention")}</TableEmpty>
      ) : (
        <TableRows label={t("section.attention")} value={value} onValueChange={onSelect}>
          {items.map((item) =>
            item.kind === "run" ? (
              <AttentionRunRow key={attentionKey(item)} run={item.run} all={all} />
            ) : (
              <RunnerAuthRow key={attentionKey(item)} runner={item.runner} />
            ),
          )}
        </TableRows>
      )}
    </Table>
  );
}

function AttentionRunRow({ run, all }: { run: HomeRun; all: boolean }) {
  const agentName = useAgentName();
  const t = useTranslations("home");
  const domain = useTranslations("domain");
  const duration = useFormatDuration();
  const status = useRunStatus();
  const reason = useRowReason();
  const { tone, label } = status(run);
  return (
    <TableRow value={runKey(run)} label={run.ticketKey}>
      <TableCell>
        <RowTitle>{run.ticketKey}</RowTitle>
        <RowReason>{reason(run)}</RowReason>
      </TableCell>
      <TableCell>
        <StatusWithCancel tone={tone} label={label} cancelling={run.cancelling} />
      </TableCell>
      <TableCell>
        {run.state === "ended" ? domain(`agentResult.${run.agentResult}`) : t("notApplicable")}
      </TableCell>
      <TableCell>
        {run.state === "ended" ? domain(`prState.${run.prState}`) : t("notApplicable")}
      </TableCell>
      <TableCell>{run.runner?.name ?? t("notApplicable")}</TableCell>
      <TableCell>{all ? run.workspace.name : agentName(run.agent)}</TableCell>
      <TableCell align="end" numeric>
        {duration(run.executionMs ?? run.waitMs)}
      </TableCell>
    </TableRow>
  );
}

function RunnerAuthRow({ runner }: { runner: BrokenAuthRunner }) {
  const t = useTranslations("home");
  return (
    <TableRow value={`runner:${runner.id}`} label={runner.name}>
      <TableCell>
        <RowTitle>{runner.name}</RowTitle>
        <RowReason>{t("row.runnerAuth")}</RowReason>
      </TableCell>
      <TableCell>
        <Status tone="failed">{t("row.runnerAuthState")}</Status>
      </TableCell>
      <TableCell>{t("notApplicable")}</TableCell>
      <TableCell>{t("notApplicable")}</TableCell>
      <TableCell>{runner.name}</TableCell>
      <TableCell>{t("notApplicable")}</TableCell>
      <TableCell align="end">{t("notApplicable")}</TableCell>
    </TableRow>
  );
}

function RunningTable({
  runs,
  value,
  onSelect,
}: {
  runs: ReadonlyArray<HomeRun>;
  value: string | null;
  onSelect: (key: string) => void;
}) {
  const agentName = useAgentName();
  const t = useTranslations("home");
  const duration = useFormatDuration();
  return (
    <Table columns={runningColumns}>
      <TableHead>
        <TableHeader>{t("columns.ticket")}</TableHeader>
        <TableHeader>{t("columns.runner")}</TableHeader>
        <TableHeader>{t("columns.agent")}</TableHeader>
        <TableHeader align="end">{t("columns.elapsed")}</TableHeader>
      </TableHead>
      {runs.length === 0 ? (
        <TableEmpty>{t("empty.running")}</TableEmpty>
      ) : (
        <TableRows label={t("section.running")} value={value} onValueChange={onSelect}>
          {runs.map((run) => (
            <TableRow key={run.id} value={runKey(run)} label={run.ticketKey}>
              <TableCell>
                <span {...stylex.props(styles.inline)}>
                  <RowTitle>{run.ticketKey}</RowTitle>
                  {run.cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
                </span>
              </TableCell>
              <TableCell>{run.runner?.name ?? t("notApplicable")}</TableCell>
              <TableCell>{agentName(run.agent)}</TableCell>
              <TableCell align="end" numeric>
                {duration(run.executionMs ?? 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableRows>
      )}
    </Table>
  );
}

function QueuedTable({
  runs,
  value,
  onSelect,
}: {
  runs: ReadonlyArray<HomeRun>;
  value: string | null;
  onSelect: (key: string) => void;
}) {
  const agentName = useAgentName();
  const t = useTranslations("home");
  const duration = useFormatDuration();
  const queuedReason = useQueuedReason();
  return (
    <Table columns={queuedColumns}>
      <TableHead>
        <TableHeader>{t("columns.ticket")}</TableHeader>
        <TableHeader>{t("columns.runner")}</TableHeader>
        <TableHeader>{t("columns.agent")}</TableHeader>
        <TableHeader align="end">{t("columns.waited")}</TableHeader>
      </TableHead>
      {runs.length === 0 ? (
        <TableEmpty>{t("empty.queued")}</TableEmpty>
      ) : (
        <TableRows label={t("section.queued")} value={value} onValueChange={onSelect}>
          {runs.map((run) => (
            <TableRow key={run.id} value={runKey(run)} label={run.ticketKey}>
              <TableCell>
                <span {...stylex.props(styles.inline)}>
                  <RowTitle>{run.ticketKey}</RowTitle>
                  {run.cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
                </span>
                {run.state === "queued" ? (
                  <RowReason>{queuedReason(run.queuedReason)}</RowReason>
                ) : null}
              </TableCell>
              <TableCell>{run.runner?.name ?? t("notApplicable")}</TableCell>
              <TableCell>{agentName(run.agent)}</TableCell>
              <TableCell align="end" numeric>
                {duration(run.waitMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableRows>
      )}
    </Table>
  );
}

function StatusWithCancel({
  tone,
  label,
  cancelling,
}: {
  tone: StatusTone;
  label: string;
  cancelling: boolean;
}) {
  const t = useTranslations("home");
  return (
    <span {...stylex.props(styles.inline)}>
      <Status tone={tone}>{label}</Status>
      {cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
    </span>
  );
}

// ---------- 패널 ----------

function RunPanel({
  run,
  onAnswer,
  onDeny,
}: {
  run: HomeRun;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const agentName = useAgentName();
  const t = useTranslations("home.panel");
  const domain = useTranslations("domain");
  const duration = useFormatDuration();
  const status = useRunStatus();
  const queuedReason = useQueuedReason();
  const { tone, label } = status(run);

  let when: string;
  let reason: string;
  switch (run.state) {
    case "queued":
      when = t("waitingFor", { duration: duration(run.waitMs) });
      reason = queuedReason(run.queuedReason);
      break;
    case "running":
    case "disconnected":
      when = t("elapsedFor", { duration: duration(run.executionMs ?? 0) });
      reason = t(`reason.${run.state}`);
      break;
    case "waiting-for-input":
      when = t("elapsedFor", { duration: duration(run.executionMs ?? 0) });
      reason = t(`reason.${run.input?.kind ?? "inputUnknown"}`);
      break;
    case "ended":
      when = t("endedAfter", { duration: duration(run.executionMs ?? 0) });
      reason = run.summary === "merged" ? "" : t(`reason.${run.summary}`);
      break;
  }
  if (run.cancelling) reason = t("reason.cancelling");

  const ended = run.state === "ended" ? run : null;
  const pr = run.pullRequest;
  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <StatusWithCancel tone={tone} label={label} cancelling={run.cancelling} />
            <Text variant="meta">{when}</Text>
          </>
        }
        title={run.ticketKey}
        subtitle={t("subtitle", { project: run.trackerProject, workspace: run.workspace.name })}
        reason={reason}
      />
      {run.state === "waiting-for-input" && run.input !== null ? (
        <InputBlock runId={run.id} input={run.input} onAnswer={onAnswer} onDeny={onDeny} />
      ) : null}
      <DefinitionList>
        <DefinitionItem label={t("state")}>{domain(`runState.${run.state}`)}</DefinitionItem>
        <DefinitionItem label={t("summary")} empty={ended === null}>
          {ended === null ? (
            t("notEnded")
          ) : (
            <Status tone={summaryTone(ended.summary)}>{domain(`summary.${ended.summary}`)}</Status>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("agentResult")} empty={ended === null}>
          {ended === null ? t("notEnded") : domain(`agentResult.${ended.agentResult}`)}
        </DefinitionItem>
        <DefinitionItem label={t("prState")} empty={ended === null}>
          {ended === null ? t("notEnded") : domain(`prState.${ended.prState}`)}
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
        <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
        {run.state === "queued" ? (
          <DefinitionItem label={t("waited")}>{duration(run.waitMs)}</DefinitionItem>
        ) : (
          <DefinitionItem label={t("elapsed")}>{duration(run.executionMs ?? 0)}</DefinitionItem>
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
      </DefinitionList>
      <PanelFooter>
        <a
          href={href("/runs", { ws: run.workspace.id, sel: run.id })}
          {...stylex.props(styles.link)}
        >
          {t("toRuns")}
        </a>
      </PanelFooter>
    </DetailPanel>
  );
}

type SendState = "idle" | "sending" | "failed";

function InputBlock({
  runId,
  input,
  onAnswer,
  onDeny,
}: {
  runId: string;
  input: InputWait;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  switch (input.kind) {
    case "question":
      return <QuestionBlock runId={runId} question={input} onAnswer={onAnswer} />;
    case "permission":
      return <PermissionBlock runId={runId} permission={input} onDeny={onDeny} />;
  }
}

/** 질문 내용과 답하기 칸. 선택지가 있으면 선택지 버튼도 둔다(Q82.3) */
function QuestionBlock({
  runId,
  question,
  onAnswer,
}: {
  runId: string;
  question: Extract<InputWait, { kind: "question" }>;
  onAnswer: HomeScreenProps["onAnswer"];
}) {
  const t = useTranslations("home.question");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const send = (text: string) => {
    if (text.trim() === "" || state === "sending") return;
    setState("sending");
    onAnswer({ runId, questionId: question.questionId, answer: text }).then(
      () => setState("idle"),
      () => setState("failed"),
    );
  };

  return (
    <PanelBlock title={t("title")}>
      <div {...stylex.props(styles.stack)}>
        <Text variant="body">{question.body}</Text>
        {question.answered ? (
          <Text variant="meta">{t("answered")}</Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              send(answer);
            }}
          >
            {question.choices.length === 0 ? null : (
              <div role="group" aria-label={t("choices")}>
                <Actions>
                  {question.choices.map((choice) => (
                    <Button
                      key={choice}
                      disabled={state === "sending"}
                      onClick={() => send(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </Actions>
              </div>
            )}
            <Field label={t("answerLabel")} error={state === "failed" ? t("failed") : undefined}>
              <Input
                name="answer"
                value={answer}
                onValueChange={setAnswer}
                placeholder={t("answerPlaceholder")}
                autoComplete="off"
              />
            </Field>
            <Actions>
              <Button
                variant="primary"
                type="submit"
                disabled={state === "sending" || answer.trim() === ""}
              >
                {state === "sending" ? t("sending") : t("send")}
              </Button>
            </Actions>
          </form>
        )}
      </div>
    </PanelBlock>
  );
}

/** 권한 대기: 허용은 러너 화면에서만 한다. 여기서는 거절만 둔다(Q82.4) */
function PermissionBlock({
  runId,
  permission,
  onDeny,
}: {
  runId: string;
  permission: Extract<InputWait, { kind: "permission" }>;
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home.permission");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  return (
    <PanelBlock title={t("title")}>
      <div {...stylex.props(styles.stack)}>
        <Text variant="body">{permission.detail}</Text>
        <Text variant="body">{t("allowOnRunner")}</Text>
        {permission.denied ? (
          <Text variant="meta">{t("denied")}</Text>
        ) : (
          <form
            {...stylex.props(styles.stack)}
            onSubmit={(event) => {
              event.preventDefault();
              if (state === "sending") return;
              setState("sending");
              onDeny({ runId, promptId: permission.promptId, reason: reason.trim() }).then(
                () => setState("idle"),
                () => setState("failed"),
              );
            }}
          >
            <Field
              label={t("reasonLabel")}
              description={t("reasonDescription")}
              error={state === "failed" ? t("failed") : undefined}
            >
              <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
            </Field>
            <Actions>
              <Button type="submit" disabled={state === "sending"}>
                {state === "sending" ? t("denying") : t("deny")}
              </Button>
            </Actions>
          </form>
        )}
      </div>
    </PanelBlock>
  );
}

/** GitHub 인증이 깨진 러너와 해결 안내(Q82.14·Q82.15) */
function RunnerAuthPanel({ runner }: { runner: BrokenAuthRunner }) {
  const t = useTranslations("home.runnerAuth");
  return (
    <DetailPanel>
      <PanelHeader
        status={<Status tone="failed">{t("state")}</Status>}
        title={runner.name}
        subtitle={t("subtitle")}
        reason={t("reason")}
      />
      <PanelBlock title={t("fixTitle")}>
        <ol {...stylex.props(styles.steps)}>
          <li>
            <Text variant="body">{t("fixToken")}</Text>
          </li>
          <li>
            <Text variant="body">{t("fixSsh")}</Text>
          </li>
          <li>
            <Text variant="body">{t("fixCheck")}</Text>
          </li>
        </ol>
      </PanelBlock>
      <PanelFooter>
        <a href={href("/runners", { sel: runner.id })} {...stylex.props(styles.link)}>
          {t("toRunners")}
        </a>
      </PanelFooter>
    </DetailPanel>
  );
}

function href(path: string, search: Record<string, string>): string {
  return `${path}?${new URLSearchParams(search).toString()}`;
}

// ---------- 문구 ----------

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

/** 상태 칸: Ended 는 요약 결과, 그 밖은 런 상태. 색은 Human Check·Failed 에만 쓴다(ADR 0007) */
function useRunStatus(): (run: HomeRun) => { tone: StatusTone; label: string } {
  const domain = useTranslations("domain");
  return (run) => {
    switch (run.state) {
      case "ended":
        return { tone: summaryTone(run.summary), label: domain(`summary.${run.summary}`) };
      case "queued":
        return { tone: "neutral", label: domain("runState.queued") };
      case "running":
      case "waiting-for-input":
      case "disconnected":
        return { tone: "running", label: domain(`runState.${run.state}`) };
    }
  };
}

/** 손댈 일 행의 이유 한 줄(ADR 0007) */
function useRowReason(): (run: HomeRun) => ReactNode {
  const t = useTranslations("home.row");
  const duration = useFormatDuration();
  const queuedReason = useQueuedReason();
  return (run) => {
    switch (run.state) {
      case "waiting-for-input":
        if (run.input === null) return t("inputUnknown");
        return run.input.kind === "question"
          ? t("question", { body: run.input.body })
          : t("permission");
      case "disconnected":
        return run.unreachableMs === null
          ? t("unreachable")
          : t("unreachableFor", { duration: duration(run.unreachableMs) });
      case "ended":
        return run.summary === "merged" || run.summary === "canceled" ? null : t(run.summary);
      case "queued":
        return queuedReason(run.queuedReason);
      case "running":
        return null;
    }
  };
}

function useQueuedReason(): (reason: QueuedReason) => string {
  const domain = useTranslations("domain.queuedReason");
  return (reason) =>
    reason.kind === "no-capacity"
      ? domain("no-capacity", { runner: reason.runner })
      : domain(reason.kind);
}

const styles = stylex.create({
  notice: {
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    paddingInlineStart: space.s5,
  },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  link: {
    color: colors.accentText,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});
