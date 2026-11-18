import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Row,
  StatusPill,
  Text,
  buttonStyles,
} from "@factory/ui";
import type { PillStatus } from "@factory/ui";
import { colors, fontSize, fontWeight, radius, space } from "@factory/ui/tokens.stylex";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { runStatus, useStatusName } from "../status";
import { activityIcons } from "./activity-icons";
import type { Activity, AttentionItem, HomePage, HomeRun, InputWait, RunnerIssue } from "./model";
import { attentionKey } from "./model";

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
  /** 질문에 답을 남긴다. 실패하면 던진다 */
  onAnswer: (input: AnswerInput) => Promise<void>;
  /** 권한 프롬프트 거절을 남긴다. 실패하면 던진다 */
  onDeny: (input: DenyInput) => Promise<void>;
}

/**
 * Home(시안 B, ADR 0010): 제목 + 한 줄 요약, 손댈 일 카드, 오른쪽 "지금 일어나는 일" 흐름.
 * 카드 행동과 질문 선택지는 모두 보조 버튼이다. 파란 주 버튼을 두지 않는다(ADR 0010 6번).
 */
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
  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={t("title")}
        subtitle={
          all
            ? t("subtitleAll", { count: page.attention.length })
            : t("subtitle", { count: page.attention.length })
        }
        actions={all ? undefined : <Counts page={page} />}
      />
      <div {...stylex.props(styles.columns)}>
        <section aria-label={t("section.attention")} {...stylex.props(styles.cards)}>
          {page.attention.length === 0 ? (
            <Card>
              <Text variant="body">{t("empty.attention")}</Text>
            </Card>
          ) : (
            page.attention.map((item) => (
              <AttentionCard
                key={attentionKey(item)}
                item={item}
                all={all}
                onAnswer={onAnswer}
                onDeny={onDeny}
              />
            ))
          )}
        </section>
        <ActivityFeed activity={page.activity} all={all} />
      </div>
    </div>
  );
}

// ---------- 머리 ----------

function Counts({ page }: { page: HomePage }) {
  const t = useTranslations("home.counts");
  const statusName = useStatusName();
  const tiles = [
    { key: "running", value: page.running.length, label: statusName("running") },
    { key: "queued", value: page.queued.length, label: statusName("queued") },
    {
      key: "merged",
      value: page.mergedToday,
      label: t("mergedToday", { merged: statusName("merged") }),
    },
  ];
  return (
    <dl aria-label={t("label")} {...stylex.props(styles.counts)}>
      {tiles.map((tile) => (
        <div key={tile.key} {...stylex.props(styles.count)}>
          <dt {...stylex.props(styles.countLabel)}>{tile.label}</dt>
          <dd {...stylex.props(styles.countValue)}>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- 손댈 일 카드 ----------

function attentionStatus(item: AttentionItem): PillStatus {
  if (item.kind === "runner-issue") return "runner-issue";
  const { run } = item;
  if (run.state === "waiting-for-input" && run.input !== null) return run.input.kind;
  return runStatus(run.state === "ended" ? run : { state: run.state });
}

function AttentionCard({
  item,
  all,
  onAnswer,
  onDeny,
}: {
  item: AttentionItem;
  all: boolean;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home");
  const statusName = useStatusName();
  const status = attentionStatus(item);
  const name = item.kind === "run" ? item.run.ticketKey : item.runner.name;
  return (
    <Card label={t("card.label", { kind: statusName(status), name })}>
      <div {...stylex.props(styles.cardHead)}>
        <StatusPill status={status}>{statusName(status)}</StatusPill>
        <span {...stylex.props(styles.key)}>{name}</span>
        {item.kind === "run" && all ? <Text variant="meta">{item.run.workspace.name}</Text> : null}
        {item.kind === "run" && item.run.cancelling ? (
          <Text variant="meta">{t("cancelling")}</Text>
        ) : null}
      </div>
      {item.kind === "run" ? (
        <RunCardBody run={item.run} onAnswer={onAnswer} onDeny={onDeny} />
      ) : (
        <RunnerIssueBody runner={item.runner} />
      )}
    </Card>
  );
}

function RunCardBody({
  run,
  onAnswer,
  onDeny,
}: {
  run: HomeRun;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home.card");
  const { duration } = useTime();
  switch (run.state) {
    case "waiting-for-input":
      if (run.input === null) {
        return (
          <>
            <Text variant="body">{t("inputUnknown")}</Text>
            <Actions>
              <RunLink run={run} />
            </Actions>
          </>
        );
      }
      return <InputCardBody run={run} input={run.input} onAnswer={onAnswer} onDeny={onDeny} />;
    case "disconnected": {
      const runner = run.runner?.name ?? t("noRunner");
      return (
        <>
          <Text variant="body">
            {run.unreachableMs === null
              ? t("unreachable", { runner })
              : t("unreachableFor", { runner, duration: duration(run.unreachableMs) })}
          </Text>
          <Actions>
            <RunLink run={run} />
          </Actions>
        </>
      );
    }
    case "ended": {
      const pr = run.pullRequest;
      return (
        <>
          <Text variant="body">
            {run.summary === "human-check"
              ? pr === null
                ? t("humanCheckNoPr")
                : t("humanCheck", { pr: pr.displayId })
              : t("failed")}
          </Text>
          <Actions>
            {pr === null ? null : (
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                data-variant="secondary"
                {...stylex.props(...buttonStyles("secondary"))}
              >
                {t("openPr")}
              </a>
            )}
            <RunLink run={run} />
          </Actions>
        </>
      );
    }
    case "queued":
    case "running":
      // 손댈 일에 오르지 않는다(needsAttention)
      return null;
  }
}

/** Run 상세로 가는 보조 버튼 모양 링크 */
function RunLink({ run }: { run: HomeRun }) {
  const t = useTranslations("home.card");
  return (
    <a
      href={href(`/runs/${encodeURIComponent(run.id)}`, { ws: run.workspace.id })}
      data-variant="secondary"
      {...stylex.props(...buttonStyles("secondary"))}
    >
      {t("openRun")}
    </a>
  );
}

type SendState = "idle" | "sending" | "failed";

function InputCardBody({
  run,
  input,
  onAnswer,
  onDeny,
}: {
  run: HomeRun;
  input: InputWait;
  onAnswer: HomeScreenProps["onAnswer"];
  onDeny: HomeScreenProps["onDeny"];
}) {
  switch (input.kind) {
    case "question":
      return <QuestionBody runId={run.id} question={input} onAnswer={onAnswer} />;
    case "permission":
      return <PermissionBody run={run} permission={input} onDeny={onDeny} />;
  }
}

/** 질문 본문과 선택지. 선택지와 "직접 답하기"는 모두 같은 보조 버튼이다(ADR 0010 6번, Q82.3) */
function QuestionBody({
  runId,
  question,
  onAnswer,
}: {
  runId: string;
  question: Extract<InputWait, { kind: "question" }>;
  onAnswer: HomeScreenProps["onAnswer"];
}) {
  const t = useTranslations("home.question");
  const [writing, setWriting] = useState(false);
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
    <>
      <p {...stylex.props(styles.question)}>{question.body}</p>
      {question.answered ? (
        <Text variant="meta">{t("answered")}</Text>
      ) : (
        <>
          <div role="group" aria-label={t("choices")}>
            <Actions>
              {question.choices.map((choice) => (
                <Button key={choice} disabled={state === "sending"} onClick={() => send(choice)}>
                  {choice}
                </Button>
              ))}
              {writing ? null : <Button onClick={() => setWriting(true)}>{t("write")}</Button>}
            </Actions>
          </div>
          {writing ? (
            <form
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault();
                send(answer);
              }}
            >
              <Field label={t("answerLabel")}>
                <Input
                  name="answer"
                  value={answer}
                  onValueChange={setAnswer}
                  placeholder={t("answerPlaceholder")}
                  autoComplete="off"
                />
              </Field>
              <Actions>
                <Button type="submit" disabled={state === "sending" || answer.trim() === ""}>
                  {state === "sending" ? t("sending") : t("send")}
                </Button>
              </Actions>
            </form>
          ) : null}
          {state === "failed" ? (
            <p role="alert" {...stylex.props(styles.error)}>
              {t("failed")}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

/** 권한 대기: 허용은 러너 화면에서만 한다. 여기서는 거절만 둔다(Q82.4) */
function PermissionBody({
  run,
  permission,
  onDeny,
}: {
  run: HomeRun;
  permission: Extract<InputWait, { kind: "permission" }>;
  onDeny: HomeScreenProps["onDeny"];
}) {
  const t = useTranslations("home.permission");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  return (
    <>
      <Text variant="body">{t("detail", { detail: permission.detail })}</Text>
      {permission.denied ? (
        <Text variant="meta">{t("denied")}</Text>
      ) : (
        <>
          <Actions>
            <RunLink run={run} />
            {open ? null : (
              <Button variant="danger" onClick={() => setOpen(true)}>
                {t("deny")}
              </Button>
            )}
          </Actions>
          {open ? (
            <form
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault();
                if (state === "sending") return;
                setState("sending");
                onDeny({
                  runId: run.id,
                  promptId: permission.promptId,
                  reason: reason.trim(),
                }).then(
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
                <Button variant="danger" type="submit" disabled={state === "sending"}>
                  {state === "sending" ? t("denying") : t("send")}
                </Button>
              </Actions>
            </form>
          ) : null}
        </>
      )}
    </>
  );
}

/** Runner Issue 러너. 까닭은 설명 문장으로, 해결 안내는 Runners 에서 본다 */
function RunnerIssueBody({ runner }: { runner: RunnerIssue }) {
  const t = useTranslations("home.runnerIssue");
  return (
    <>
      <Text variant="body">{t(runner.cause)}</Text>
      <Actions>
        <a
          href={href("/runners", { sel: runner.id })}
          data-variant="secondary"
          {...stylex.props(...buttonStyles("secondary"))}
        >
          {t("fix")}
        </a>
      </Actions>
    </>
  );
}

function href(path: string, search: Record<string, string>): string {
  return `${path}?${new URLSearchParams(search).toString()}`;
}

// ---------- 지금 일어나는 일 ----------

function ActivityFeed({ activity, all }: { activity: ReadonlyArray<Activity>; all: boolean }) {
  const t = useTranslations("home.activity");
  const { ago } = useTime();
  const text = useActivityText();
  return (
    <aside {...stylex.props(styles.feed)}>
      <Card padding="compact" label={t("title")}>
        <h2 {...stylex.props(styles.feedTitle)}>{t("title")}</h2>
        {activity.length === 0 ? (
          <p {...stylex.props(styles.feedEmpty)}>{t("empty")}</p>
        ) : (
          <ol {...stylex.props(styles.feedList)}>
            {activity.map((item) => (
              <li key={item.key}>
                <Row
                  leading={
                    <span {...stylex.props(styles.feedIcon)}>{activityIcons[item.event.kind]}</span>
                  }
                  trailing={<time dateTime={item.at}>{ago(item.at, item.agoMs)}</time>}
                >
                  <span {...stylex.props(styles.feedLine)}>
                    <span {...stylex.props(styles.key)}>{item.ticketKey}</span>
                    <span {...stylex.props(styles.feedText)}>{text(item)}</span>
                    {all ? <Text variant="meta">{item.workspace.name}</Text> : null}
                  </span>
                </Row>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </aside>
  );
}

function useActivityText(): (item: Activity) => string {
  const t = useTranslations("home.activity");
  const statusName = useStatusName();
  return ({ event }) => {
    switch (event.kind) {
      case "started":
      case "question":
      case "permission":
      case "disconnected":
        return t(event.kind);
      case "ended":
        return t("ended", { summary: statusName(event.summary) });
      case "later-pr":
        return t(`laterPr.${event.state}`);
    }
  };
}

/** 오른쪽 흐름 폭(시안 B) */
const FEED_WIDTH = 380;

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${FEED_WIDTH}px`,
      "@media (max-width: 1100px)": "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s6,
  },
  cards: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  cardHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
  },
  key: {
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  question: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
  },
  form: { display: "flex", flexDirection: "column", gap: space.s3, maxWidth: 560 },
  error: { margin: 0, color: colors.problem, fontSize: fontSize.ui },
  counts: { display: "flex", gap: space.s2, margin: 0 },
  count: {
    display: "flex",
    flexDirection: "column-reverse",
    gap: space.s1,
    minWidth: 80,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  countLabel: { color: colors.textTertiary, fontSize: fontSize.small, whiteSpace: "nowrap" },
  countValue: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
  },
  feed: { minWidth: 0 },
  feedTitle: {
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  feedEmpty: {
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: colors.textTertiary,
  },
  feedList: { margin: 0, padding: 0, listStyle: "none" },
  feedIcon: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.control,
    backgroundColor: colors.bgControl,
    color: colors.textSecondary,
  },
  feedLine: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  feedText: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: colors.textPrimary,
  },
});
