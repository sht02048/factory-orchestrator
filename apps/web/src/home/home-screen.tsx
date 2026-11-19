import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  CapacityCells,
  Card,
  KanbanCards,
  KanbanColumn,
  KanbanSubheading,
  ProblemCallout,
  Row,
  Section,
  SegmentedTabs,
  StatusDot,
  Text,
  TextLink,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { USAGE_HIGH_PERCENT } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useUsageNames } from "../labels";
import { useStatusName } from "../status";
import type { DashboardRunner, HomePage, HomeRun } from "@ganger/app/home/model";
import {
  dashboardBoard,
  freeCapacity,
  limitedRunners,
  readyAgainInMs,
  runnerIssues,
  todoGroups,
} from "@ganger/app/home/model";
import { RunCard } from "./run-card";
import type { SheetMode } from "./run-card";
import { RunSheet } from "./run-sheet";
import type { SheetTarget } from "./run-sheet";
import { href } from "./run-text";

export { runHref } from "./run-text";

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

export const DASHBOARD_VIEWS = ["all", "todo"] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export interface HomeScreenProps {
  page: HomePage;
  view?: DashboardView;
  onViewChange?: (view: DashboardView) => void;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  openRunId?: RunId | undefined;
  onOpenRunShown?: () => void;
}

export const COLUMN_VISIBLE = 6;
export const DONE_TODO_VISIBLE = 4;
export const SETTLED_VISIBLE = 3;

interface CardHost {
  all: boolean;
  selectedId: RunId | null;
  revealedId: RunId | null;
  cardRef: (id: RunId) => (element: HTMLButtonElement | null) => void;
  focusCard: (id: RunId) => void;
  onOpen: (run: HomeRun, tagged: boolean, mode: SheetMode) => void;
}

export function HomeScreen({
  page,
  view = "all",
  onViewChange = () => {},
  onAnswer,
  onDeny,
  openRunId,
  onOpenRunShown = () => {},
}: HomeScreenProps) {
  const t = useTranslations("home");
  const cards = useRef(new Map<RunId, HTMLButtonElement>());
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [revealedId, setRevealedId] = useState<RunId | null>(null);
  const shownRunId = useRef<RunId | undefined>(undefined);
  useEffect(() => {
    if (openRunId === undefined || shownRunId.current === openRunId) return;
    if (page.workspace.kind === "none") return;
    shownRunId.current = openRunId;
    const run = boardRuns(dashboardBoard(page)).find((candidate) => candidate.id === openRunId);
    onOpenRunShown();
    if (run === undefined) return;
    const tagged = page.attention.some((item) => item.run.id === run.id);
    setRevealedId(run.id);
    setTarget({ run, tagged, mode: opensAnswer(run) ? "answer" : "summary" });
    setOpen(true);
  }, [openRunId, page, onOpenRunShown]);
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
  const board = dashboardBoard(page);
  const todoOnly = view === "todo";
  const fresh =
    target === null ? undefined : boardRuns(board).find((run) => run.id === target.run.id);
  const host: CardHost = {
    all,
    selectedId: open && target !== null ? target.run.id : null,
    revealedId,
    cardRef: (id) => (element) => {
      if (element === null) cards.current.delete(id);
      else cards.current.set(id, element);
    },
    focusCard: (id) => cards.current.get(id)?.focus(),
    onOpen: (run, tagged, mode) => {
      setTarget({ run, tagged, mode });
      setOpen(true);
    },
  };
  const runningTodo = new Set(board.running.todo.map((run) => run.id));
  const todoIds = new Set(page.attention.map(({ run }) => run.id));
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.top)}>
        <DashboardHeader page={page} all={all} />
        <SegmentedTabs<DashboardView>
          value={view}
          onValueChange={onViewChange}
          label={t("view.label")}
          items={[
            { value: "all", label: t("view.all") },
            {
              value: "todo",
              label: t("view.todo"),
              count: page.attention.length,
              attention: true,
            },
          ]}
        />
      </div>
      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.board)}>
          <KanbanColumn title={t("column.queued")} count={todoOnly ? 0 : board.queued.length}>
            <CardList
              runs={todoOnly ? [] : board.queued}
              tagged={() => false}
              limit={COLUMN_VISIBLE}
              empty={todoOnly ? t("columnEmpty.todo") : t("columnEmpty.queued")}
              host={host}
            />
          </KanbanColumn>
          <KanbanColumn
            title={t("column.running")}
            count={
              todoOnly
                ? board.running.todo.length
                : board.running.todo.length + board.running.rest.length
            }
          >
            <CardList
              runs={todoOnly ? board.running.todo : [...board.running.todo, ...board.running.rest]}
              tagged={(run) => runningTodo.has(run.id)}
              limit={COLUMN_VISIBLE}
              empty={todoOnly ? t("columnEmpty.todo") : t("columnEmpty.running")}
              host={host}
            />
          </KanbanColumn>
          <KanbanColumn
            title={t("column.done")}
            count={
              todoOnly ? board.done.todo.length : board.done.todo.length + board.done.rest.length
            }
          >
            <CardList
              runs={board.done.todo}
              tagged={() => true}
              limit={DONE_TODO_VISIBLE}
              empty={
                todoOnly
                  ? t("columnEmpty.todo")
                  : board.done.rest.length === 0
                    ? t("columnEmpty.done")
                    : null
              }
              host={host}
            />
            {todoOnly || board.done.rest.length === 0 ? null : (
              <SettledCards runs={board.done.rest} page={page} host={host} />
            )}
          </KanbanColumn>
          <div {...stylex.props(styles.runners)}>
            <RunnersSection runners={page.runners.list} />
          </div>
        </div>
      </div>
      <RunSheet
        target={
          fresh === undefined || target === null
            ? target
            : { ...target, run: fresh, tagged: todoIds.has(fresh.id) }
        }
        open={open}
        onOpenChange={setOpen}
        finalFocus={() => (target === null ? null : (cards.current.get(target.run.id) ?? null))}
        all={all}
        onAnswer={onAnswer}
        onDeny={onDeny}
      />
    </div>
  );
}

function boardRuns(board: ReturnType<typeof dashboardBoard>): HomeRun[] {
  return [
    ...board.queued,
    ...board.running.todo,
    ...board.running.rest,
    ...board.done.todo,
    ...board.done.rest,
  ];
}

function opensAnswer(run: HomeRun): boolean {
  return run.state === "waiting-for-input" && run.input?.kind === "question" && !run.input.answered;
}

function DashboardHeader({ page, all }: { page: HomePage; all: boolean }) {
  const t = useTranslations("home");
  const { duration } = useTime();
  const groups = todoGroups(page.attention);
  const total = page.attention.length;
  const inProgress = page.running.length + page.queued.length;
  const limited = limitedRunners(page.runners);
  const readyTimes = limited.flatMap((runner) => {
    const ms = readyAgainInMs(runner);
    return ms === null ? [] : [ms];
  });
  const limitSentence =
    limited.length === 0
      ? null
      : readyTimes.length === 0
        ? t("summary.limitUnknown", { count: limited.length })
        : t("summary.limit", {
            count: limited.length,
            duration: duration(Math.min(...readyTimes)),
          });
  const work =
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
      <Text variant="body">
        {limitSentence === null ? work : t("summary.withLimit", { work, limit: limitSentence })}
      </Text>
    </header>
  );
}

function CardList({
  runs,
  tagged,
  limit,
  empty,
  host,
}: {
  runs: HomeRun[];
  tagged: (run: HomeRun) => boolean;
  limit: number;
  empty: string | null;
  host: CardHost;
}) {
  const t = useTranslations("home.board");
  const [expanded, setExpanded] = useState(false);
  const focusAfterExpand = useRef<RunId | null>(null);
  useEffect(() => {
    const id = focusAfterExpand.current;
    if (!expanded || id === null) return;
    focusAfterExpand.current = null;
    host.focusCard(id);
  }, [expanded, host]);
  if (runs.length === 0)
    return empty === null ? null : (
      <Text variant="meta" as="p">
        {empty}
      </Text>
    );
  const revealed = runs.slice(limit).some((run) => run.id === host.revealedId);
  const visible = expanded || revealed ? runs : runs.slice(0, limit);
  const hidden = runs.length - visible.length;
  return (
    <>
      <KanbanCards>
        {visible.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            tagged={tagged(run)}
            all={host.all}
            selected={host.selectedId === run.id}
            openRef={host.cardRef(run.id)}
            onOpen={(mode) => host.onOpen(run, tagged(run), mode)}
          />
        ))}
      </KanbanCards>
      {hidden > 0 ? (
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              focusAfterExpand.current = runs[limit]?.id ?? null;
              setExpanded(true);
            }}
          >
            {t("more", { count: hidden })}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function SettledCards({ runs, page, host }: { runs: HomeRun[]; page: HomePage; host: CardHost }) {
  const t = useTranslations("home.board");
  const first = runs.slice(0, SETTLED_VISIBLE);
  const revealed = runs.slice(SETTLED_VISIBLE).find((run) => run.id === host.revealedId);
  const visible = revealed === undefined ? first : [...first, revealed];
  return (
    <div data-settled="" {...stylex.props(styles.settled)}>
      <KanbanSubheading>{t("settled")}</KanbanSubheading>
      <KanbanCards>
        {visible.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            tagged={false}
            all={host.all}
            selected={host.selectedId === run.id}
            openRef={host.cardRef(run.id)}
            onOpen={(mode) => host.onOpen(run, false, mode)}
          />
        ))}
      </KanbanCards>
      {runs.length > visible.length ? (
        <div {...stylex.props(styles.allRuns)}>
          <TextLink href={runsHref(page)}>{t("allRuns")}</TextLink>
        </div>
      ) : null}
    </div>
  );
}

function RunnersSection({ runners }: { runners: DashboardRunner[] }) {
  const t = useTranslations("home");
  const { duration } = useTime();
  const issues = runnerIssues({ list: runners });
  const offline = issues
    .filter((runner) => runner.cause === "offline")
    .map((runner) =>
      runner.offlineMs === null
        ? runner.name
        : t("runners.offlineName", { name: runner.name, duration: duration(runner.offlineMs) }),
    );
  const auth = issues.filter((runner) => runner.cause === "auth").map((runner) => runner.name);
  const names = useUsageNames();
  const limited = limitedRunners({ list: runners });
  const limitLines = limited.flatMap((runner) =>
    runner.limits.map((limit) => {
      const values = {
        provider: names.provider(limit.provider),
        window: names.window(limit.window),
        name: runner.name,
      };
      return {
        key: `${runner.id}:${limit.provider}:${limit.window}`,
        text:
          limit.resetsInMs === null
            ? t("runners.limitUnknown", values)
            : t("runners.limit", { ...values, duration: duration(limit.resetsInMs) }),
      };
    }),
  );
  const problemCount = new Set([...issues, ...limited].map((runner) => runner.id)).size;
  return (
    <Card surface="plain" label={t("section.runners")}>
      <Section
        title={t("section.runners")}
        titleRole="subheading"
        headingLevel="h2"
        count={runners.length}
        {...(runners.length === 0
          ? {}
          : { note: t("runners.free", { count: freeCapacity({ list: runners }) }) })}
      >
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
            {problemCount === 0 ? null : (
              <ProblemCallout
                title={t("runners.problemTitle", { count: problemCount })}
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
                {limitLines.map((line) => (
                  <p key={line.key} {...stylex.props(styles.reset)}>
                    {line.text}
                  </p>
                ))}
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
        trailing={
          <CapacityCells
            used={runner.used}
            total={runner.capacity}
            label={t("capacity", { used: runner.used, total: runner.capacity })}
            tone={runner.cause === null ? "progress" : "problem"}
          />
        }
      >
        <span {...stylex.props(styles.runnerText)}>
          <Text variant="title" truncate>
            {runner.name}
          </Text>
          <RunnerUsage runner={runner} />
        </span>
      </Row>
    </li>
  );
}

function RunnerUsage({ runner }: { runner: DashboardRunner }) {
  const t = useTranslations("home.runners");
  const names = useUsageNames();
  if (runner.usage === null) return null;
  const { provider, window, usedPercent } = runner.usage;
  return (
    <Text
      variant="meta"
      numeric
      {...(usedPercent >= USAGE_HIGH_PERCENT ? { tone: "problem" } : {})}
    >
      {t("usage", {
        provider: names.provider(provider),
        window: names.window(window),
        percent: Math.round(usedPercent),
      })}
    </Text>
  );
}

function runsHref(page: HomePage): string {
  return page.workspace.kind === "one"
    ? href("/runs", { ws: page.workspace.workspace.id })
    : "/runs";
}

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: space.s10,
  },
  top: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    columnGap: space.s6,
    rowGap: space.s4,
    marginBottom: space.s8,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
  },
  frame: { containerType: "inline-size" },
  board: {
    display: "grid",
    gridTemplateColumns: {
      default: `repeat(3, minmax(0, 1fr)) ${size.dashboardSideWidth}`,
      [breakpoints.kanbanRunnersBelow]: "repeat(3, minmax(0, 1fr))",
      [breakpoints.kanbanStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    columnGap: space.s4,
    rowGap: { default: space.s4, [breakpoints.kanbanRunnersBelow]: space.s8 },
  },
  runners: {
    gridColumn: {
      default: "auto",
      [breakpoints.kanbanRunnersBelow]: "1 / -1",
      [breakpoints.kanbanStacked]: "1 / -1",
    },
    minWidth: 0,
    paddingInlineStart: {
      default: space.s4,
      [breakpoints.kanbanRunnersBelow]: 0,
      [breakpoints.kanbanStacked]: 0,
    },
    paddingTop: { default: space.s3, [breakpoints.kanbanStacked]: space.s4 },
  },
  settled: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  allRuns: { paddingInline: space.s1 },
  sideBlock: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  runnerText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  rows: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reset: { margin: 0 },
});
