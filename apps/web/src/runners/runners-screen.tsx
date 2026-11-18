import * as stylex from "@stylexjs/stylex";
import { Card, PageHeader, Row, StatusPill, Text, buttonStyles } from "@factory/ui";
import { colors, fontSize, fontWeight, fonts, radius, space } from "@factory/ui/tokens.stylex";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { usePrerequisiteName } from "../labels";
import { runnerIssueCause } from "../shell/model";
import { useStatusName } from "../status";
import type { RunWorkspace, RunnerCheckItem, RunnerView, RunnersPage } from "./model";

/** 러너 추가는 Settings 의 러너 등록에서 한다. 보던 Workspace(ws)를 이어 간다 */
export function addRunnerHref(ws: string | undefined): string {
  const search = new URLSearchParams(ws === undefined ? {} : { ws });
  search.set("sel", "runners");
  return `/settings?${search.toString()}`;
}

/** capacity 막대를 칸으로 나눠 그리는 가장 큰 capacity. 넘으면 한 줄 막대로 그린다 */
const MAX_SEGMENTS = 12;

export interface RunnersScreenProps {
  page: RunnersPage;
  /** 주소로 고른 러너(Home 의 Runner Issue 카드에서 온다). 그 카드로 스크롤하고 테두리로 보인다 */
  selectedId: string | undefined;
  /** 보던 Workspace. 러너 추가 링크가 이어 간다 */
  ws: string | undefined;
}

/**
 * Runners: 러너 카드(시안 B, ADR 0010). Online·Offline 알약, capacity 막대, 확인 항목, 문제가 있으면 해결 안내.
 * Workspace 와 상관없는 공용 화면이라 모든 Workspace 의 런을 보인다(ADR 0006).
 * 파란 주 버튼은 "러너 추가" 하나다(ADR 0010 6번).
 */
export function RunnersScreen({ page, selectedId, ws }: RunnersScreenProps) {
  const t = useTranslations("runners");
  const { runners } = page;
  const issues = runners.filter((r) => runnerIssueCause(r) !== null).length;
  const available = runners.filter(
    (r) => runnerIssueCause(r) === null && r.occupying.length < r.capacity,
  ).length;

  useEffect(() => {
    if (selectedId === undefined) return;
    document.getElementById(cardId(selectedId))?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={t("title")}
        subtitle={
          runners.length === 0
            ? t("noRunners")
            : t("subtitle", { total: runners.length, available, issues })
        }
        actions={
          <a
            href={addRunnerHref(ws)}
            data-variant="primary"
            {...stylex.props(...buttonStyles("primary"))}
          >
            {t("add")}
          </a>
        }
      />
      {runners.length === 0 ? null : (
        <ul aria-label={t("listLabel")} {...stylex.props(styles.grid)}>
          {runners.map((runner) => (
            <li
              key={runner.id}
              id={cardId(runner.id)}
              aria-current={runner.id === selectedId ? "true" : undefined}
              {...stylex.props(styles.cell, runner.id === selectedId && styles.selected)}
            >
              <RunnerCard runner={runner} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cardId(runnerId: string): string {
  return `runner-${runnerId}`;
}

function RunnerCard({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card");
  const statusName = useStatusName();
  const { ago } = useTime();
  const cause = runnerIssueCause(runner);
  const online = runner.online ? "online" : "offline";
  return (
    <Card label={t("label", { name: runner.name })}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.name)}>
          <h2 {...stylex.props(styles.title)}>{runner.name}</h2>
          {runner.sshTarget === null ? null : (
            <Text variant="meta" mono truncate>
              {runner.sshTarget}
            </Text>
          )}
        </div>
        <div {...stylex.props(styles.pills)}>
          <StatusPill status={online}>{statusName(online)}</StatusPill>
          {cause === "auth" ? (
            <StatusPill status="runner-issue">{statusName("runner-issue")}</StatusPill>
          ) : null}
        </div>
      </div>
      <Text variant="body">
        <Summary runner={runner} />
      </Text>
      <CapacityBar runner={runner} />
      <RunList runner={runner} />
      <CheckList runner={runner} />
      {cause === null ? null : (
        <div role="note" {...stylex.props(styles.fix)}>
          <Text variant="label">{t("fixTitle")}</Text>
          <p {...stylex.props(styles.fixBody)}>
            {cause === "offline"
              ? t("fix.offline")
              : t.rich("fix.assignmentBlocked", {
                  code: (chunks) => <code {...stylex.props(styles.code)}>{chunks}</code>,
                })}
          </p>
        </div>
      )}
      <LeftWorktrees runner={runner} />
      <Text variant="meta">
        {runner.checked === null
          ? t("neverChecked")
          : t("checkedAgo", { time: ago(runner.checked.at, runner.checked.agoMs) })}
      </Text>
    </Card>
  );
}

function Summary({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card.summary");
  const free = Math.max(0, runner.capacity - runner.occupying.length);
  if (!runner.online) return t("offline");
  if (runner.assignmentBlocked) return t("assignmentBlocked");
  if (free > 0) return t("free", { free });
  return runner.queued.length === 0 ? t("full") : t("fullWaiting", { count: runner.queued.length });
}

/** "Capacity 2/2"와 막대(ADR 0010 7번: 비율은 "2/2"로 쓴다). Offline 이면 막대가 빨갛다 */
function CapacityBar({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card");
  const occupied = Math.min(runner.occupying.length, runner.capacity);
  const segments = runner.capacity <= MAX_SEGMENTS;
  const fill = runner.online ? styles.fillOnline : styles.fillOffline;
  return (
    <div {...stylex.props(styles.capacity)}>
      <div {...stylex.props(styles.capacityHead)}>
        <span>{t("capacity")}</span>
        <span {...stylex.props(styles.numeric)}>
          {t("load", { occupied: runner.occupying.length, capacity: runner.capacity })}
        </span>
      </div>
      <div aria-hidden="true" {...stylex.props(styles.bar)}>
        {segments ? (
          Array.from({ length: runner.capacity }, (_, i) => (
            <span key={i} {...stylex.props(styles.segment, i < occupied && fill)} />
          ))
        ) : (
          <span {...stylex.props(styles.segment)}>
            <span
              {...stylex.props(
                styles.track,
                fill,
                styles.trackWidth(`${(occupied / runner.capacity) * 100}%`),
              )}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** capacity 를 차지하는 런과 기다리는 런. 티켓 키는 그 런의 Workspace 로 연 Runs 로 이어진다 */
function RunList({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card");
  const statusName = useStatusName();
  const { elapsed, duration } = useTime();
  if (runner.occupying.length === 0 && runner.queued.length === 0) return null;
  return (
    <ol aria-label={t("runs")} {...stylex.props(styles.list)}>
      {runner.occupying.map((run) => (
        <li key={run.id}>
          <Row
            leading={<StatusPill status={run.state}>{statusName(run.state)}</StatusPill>}
            trailing={elapsed(run.executionMs)}
          >
            <RunLabel ticketKey={run.ticketKey} runId={run.id} workspace={run.workspace} />
          </Row>
        </li>
      ))}
      {runner.queued.map((run) => (
        <li key={run.id}>
          <Row
            leading={<StatusPill status="queued">{statusName("queued")}</StatusPill>}
            trailing={t("queuedFor", { duration: duration(run.waitMs) })}
          >
            <RunLabel ticketKey={run.ticketKey} runId={run.id} workspace={run.workspace} />
          </Row>
        </li>
      ))}
    </ol>
  );
}

function RunLabel({
  ticketKey,
  runId,
  workspace,
  meta,
}: {
  ticketKey: string;
  runId: string;
  workspace: RunWorkspace;
  meta?: ReactNode;
}) {
  return (
    <span {...stylex.props(styles.runLabel)}>
      <a href={runHref(workspace.id, runId)} {...stylex.props(styles.runLink)}>
        {ticketKey}
      </a>
      <Text variant="meta" truncate>
        {meta ?? workspace.name}
      </Text>
    </span>
  );
}

/**
 * 러너 확인 항목(스펙 9절). Offline 이면 마지막 결과 대신 닿지 않는다는 것 하나를 보인다.
 * GitHub push 는 프로젝트마다다(Q82.15).
 */
function CheckList({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card");
  const prerequisiteName = usePrerequisiteName();
  if (!runner.online) {
    return (
      <ul aria-label={t("checks")} {...stylex.props(styles.list)}>
        <CheckLine state="broken">{t("unreachable")}</CheckLine>
      </ul>
    );
  }
  const checks = runner.checks;
  if (checks === null || checks.length === 0) {
    return <Text variant="meta">{t("noChecks")}</Text>;
  }
  return (
    <ul aria-label={t("checks")} {...stylex.props(styles.list)}>
      {checks.map((check) => (
        <CheckLine
          key={check.id}
          state={checkState(check)}
          hint={check.satisfied === false ? check.hint : null}
        >
          {prerequisiteName(check)}
        </CheckLine>
      ))}
    </ul>
  );
}

type CheckState = "ok" | "broken" | "unknown";

function checkState(check: RunnerCheckItem): CheckState {
  if (check.satisfied === null) return "unknown";
  return check.satisfied ? "ok" : "broken";
}

function CheckLine({
  state,
  hint = null,
  children,
}: {
  state: CheckState;
  /** 깨진 항목의 해결 안내(Orca 상시 서비스 설치 명령 등) */
  hint?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("runners.card.check");
  return (
    <li {...stylex.props(styles.check)}>
      <span
        role="img"
        aria-label={t(state)}
        {...stylex.props(
          styles.checkIcon,
          state === "ok" && styles.ok,
          state === "broken" && styles.broken,
        )}
      >
        {checkIcons[state]}
      </span>
      <span {...stylex.props(styles.checkText)}>
        <span {...stylex.props(styles.checkName)}>{children}</span>
        {hint === null ? null : <code {...stylex.props(styles.hint)}>{hint}</code>}
      </span>
    </li>
  );
}

function LeftWorktrees({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.card");
  if (runner.leftWorktrees.length === 0) return null;
  return (
    <div {...stylex.props(styles.capacity)}>
      <Text variant="label">{t("leftWorktrees", { count: runner.leftWorktrees.length })}</Text>
      <ul {...stylex.props(styles.list)}>
        {runner.leftWorktrees.map((run) => (
          <li key={run.id}>
            <Row>
              <RunLabel
                ticketKey={run.ticketKey}
                runId={run.id}
                workspace={run.workspace}
                meta={t("worktreeMeta", {
                  workspace: run.workspace.name,
                  reason: t(`worktree.${run.worktree}`),
                })}
              />
            </Row>
          </li>
        ))}
      </ul>
    </div>
  );
}

function runHref(workspaceId: string, runId: string): string {
  return `/runs?${new URLSearchParams({ ws: workspaceId, sel: runId }).toString()}`;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6.25" />
      {children}
    </svg>
  );
}

// 확인 항목 아이콘. 통과는 초록(정상), 깨짐은 빨강(문제)으로 ADR 0010 5번의 뜻을 따른다
const checkIcons: Record<CheckState, ReactNode> = {
  ok: (
    <Icon>
      <path d="m5.5 8.2 1.7 1.7 3.3-3.6" />
    </Icon>
  ),
  broken: (
    <Icon>
      <path d="M8 4.8v3.6M8 11h.01" />
    </Icon>
  ),
  unknown: (
    <Icon>
      <path d="M6.5 6.4a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.6-.7 1.1M8 11h.01" />
    </Icon>
  ),
};

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    alignItems: "start",
    gap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  cell: { minWidth: 0, borderRadius: radius.card },
  selected: { outline: `2px solid ${colors.accentText}`, outlineOffset: 2 },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s3,
    minWidth: 0,
  },
  name: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pills: { display: "flex", flexShrink: 0, gap: space.s1 },
  capacity: { display: "flex", flexDirection: "column", gap: space.s2 },
  capacityHead: {
    display: "flex",
    justifyContent: "space-between",
    color: colors.textTertiary,
    fontSize: fontSize.ui,
  },
  numeric: { color: colors.textSecondary, fontVariantNumeric: "tabular-nums" },
  bar: { display: "flex", gap: space.s1, height: 6 },
  segment: {
    position: "relative",
    flexGrow: 1,
    flexBasis: 0,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.bgControl,
  },
  track: { position: "absolute", insetBlock: 0, insetInlineStart: 0 },
  trackWidth: (width: string) => ({ width }),
  fillOnline: { backgroundColor: colors.progress },
  fillOffline: { backgroundColor: colors.problem },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  runLabel: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  runLink: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  check: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  checkText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  hint: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: fontSize.small,
    overflowWrap: "anywhere",
  },
  checkIcon: { display: "inline-flex", flexShrink: 0, color: colors.textTertiary },
  ok: { color: colors.progress },
  broken: { color: colors.problem },
  checkName: {
    minWidth: 0,
    color: colors.textSecondary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fix: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s4,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
  },
  fixBody: { margin: 0, color: colors.textSecondary, overflowWrap: "anywhere" },
  code: { fontFamily: fonts.mono },
});
