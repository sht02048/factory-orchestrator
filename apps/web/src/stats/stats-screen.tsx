import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  FailureBar,
  NoticeLayout,
  OutcomeSwatch,
  PageHeader,
  Section,
  SegmentedTabs,
  StatTile,
  TabPanel,
  Text,
} from "@ganger/ui";
import type { StatTrend } from "@ganger/ui";
import { breakpoints, space } from "@ganger/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import type { WorkspaceSummary } from "@ganger/app/shell/model";
import {
  PR_STATE_ORDER,
  STATS_DIMENSIONS,
  STATS_PERIOD_DAYS,
  humanTouchedRate,
  mergedRate,
  mergedRateChange,
} from "@ganger/app/stats/model";
import type {
  FailureReasonCount,
  StatsDimension,
  StatsGroup,
  StatsPage,
  StatsPeriodDays,
  StatsSummary,
} from "@ganger/app/stats/model";
import { BreakdownTable } from "./outcome-bar";
import { ThroughputChart } from "./throughput-chart";

export interface StatsScreenProps {
  page: StatsPage;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  dimension: StatsDimension;
  onDimensionChange: (dimension: StatsDimension) => void;
  onPeriodChange: (days: StatsPeriodDays) => void;
  onPickWorkspace: (workspaceId: string) => void;
  runsHref?: (dimension: StatsDimension, key: string, days: StatsPeriodDays) => string;
  onOpenRuns?: (dimension: StatsDimension, key: string, days: StatsPeriodDays) => void;
}

export function StatsScreen(props: StatsScreenProps) {
  const { page } = props;
  switch (page.workspace.kind) {
    case "none":
      return <Notice body={<NoWorkspace />} />;
    case "all":
      return (
        <Notice
          body={
            <AllWorkspaces workspaces={props.workspaces} onPickWorkspace={props.onPickWorkspace} />
          }
        />
      );
    case "one":
      return "total" in page ? (
        <StatsView {...props} page={page} workspaceName={page.workspace.workspace.name} />
      ) : null;
  }
}

type LoadedStatsPage = Extract<StatsPage, { total: StatsSummary }>;

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("stats");
  return (
    <NoticeLayout>
      <PageHeader title={t("title")} subtitle={t("summary")} />
      {body}
    </NoticeLayout>
  );
}

function NoWorkspace() {
  const t = useTranslations("stats");
  return <Text variant="body">{t("noWorkspace")}</Text>;
}

function AllWorkspaces({
  workspaces,
  onPickWorkspace,
}: {
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onPickWorkspace: (workspaceId: string) => void;
}) {
  const t = useTranslations("stats.allWorkspaces");
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="body">{t("body")}</Text>
      <Actions>
        {workspaces.map((w) => (
          <Button key={w.id} onClick={() => onPickWorkspace(w.id)}>
            {t("pick", { name: w.name })}
          </Button>
        ))}
      </Actions>
    </div>
  );
}

function StatsView({
  page,
  dimension,
  onDimensionChange,
  onPeriodChange,
  runsHref,
  onOpenRuns,
  workspaceName,
}: Omit<StatsScreenProps, "page"> & { page: LoadedStatsPage; workspaceName: string }) {
  const t = useTranslations("stats");
  const { statsDay: dayLabel } = useTime();
  const days = page.period.days;

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.frame)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.headline)}>
            <Text variant="meta">
              {t("meta", {
                workspace: workspaceName,
                days,
                from: dayLabel(page.period.firstDay).long,
                to: dayLabel(page.period.lastDay).long,
              })}
            </Text>
            <Text variant="display" as="h1">
              <Headline total={page.total} days={days} />
            </Text>
          </div>
          <SegmentedTabs<`${StatsPeriodDays}`>
            value={`${days}`}
            onValueChange={(next) => {
              const picked = STATS_PERIOD_DAYS.find((d) => `${d}` === next);
              if (picked !== undefined) onPeriodChange(picked);
            }}
            label={t("period.label")}
            items={STATS_PERIOD_DAYS.map((d) => ({
              value: `${d}` as const,
              label: t("period.option", { days: d }),
            }))}
          />
        </header>
        <Figures total={page.total} previous={page.previous} days={days} />
        <div {...stylex.props(styles.sections)}>
          <Section
            title={t("throughput.title")}
            titleRole="heading"
            note={page.total.runs === 0 ? undefined : <Legend />}
          >
            <ThroughputChart daily={page.daily} days={days} />
          </Section>
          <Section
            title={t("failures.title")}
            titleRole="heading"
            count={page.total.outcomes.failed}
          >
            {page.total.failureReasons.length === 0 ? (
              <Text variant="meta">{t("failures.empty")}</Text>
            ) : (
              <FailureReasons reasons={page.total.failureReasons} />
            )}
          </Section>
          <Section title={t("dimension.title")} titleRole="heading">
            <Breakdown
              groups={page.groups[dimension]}
              dimension={dimension}
              days={days}
              onDimensionChange={onDimensionChange}
              {...(runsHref === undefined
                ? {}
                : { runsHref: (key: string) => runsHref(dimension, key, days) })}
              {...(onOpenRuns === undefined
                ? {}
                : { onOpenRuns: (key: string) => onOpenRuns(dimension, key, days) })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Headline({ total, days }: { total: StatsSummary; days: number }) {
  const t = useTranslations("stats.headline");
  const rate = mergedRate(total);
  if (total.runs === 0) return <>{t("empty", { days })}</>;
  if (rate === null) return <>{t("onlyCanceled", { runs: total.runs })}</>;
  return (
    <>
      {total.outcomes.canceled === 0
        ? t("rated", { runs: total.rated, percent: rate })
        : t("ratedWithCanceled", { runs: total.rated, percent: rate })}
    </>
  );
}

function Legend() {
  const t = useTranslations("stats.throughput.columns");
  return (
    <span {...stylex.props(styles.legend)}>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="merged" />
        {t("merged")}
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="check" />
        {t("check")}
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="failed" />
        {t("failed")}
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="canceled" />
        {t("canceled")}
      </span>
    </span>
  );
}

function usePercentText(): (value: number | null) => string {
  const t = useTranslations("stats");
  return (value) => (value === null ? t("notApplicable") : t("percent", { percent: value }));
}

function Figures({
  total,
  previous,
  days,
}: {
  total: StatsSummary;
  previous: StatsSummary;
  days: number;
}) {
  const t = useTranslations("stats");
  const { duration } = useTime();
  const percentText = usePercentText();
  const change = mergedRateChange(total, previous);
  const rate = mergedRate(total);
  const trend: StatTrend | undefined =
    change === null || change === 0 ? undefined : change > 0 ? "better" : "worse";

  return (
    <section aria-label={t("figures.label")} {...stylex.props(styles.figures)}>
      <StatTile
        label={t("figures.mergedRate")}
        value={percentText(rate)}
        {...(rate === null
          ? {}
          : {
              detail:
                change === null
                  ? t("figures.noPrevious", { days })
                  : change === 0
                    ? t("figures.same", { days })
                    : t(change > 0 ? "figures.up" : "figures.down", {
                        days,
                        points: Math.abs(change),
                      }),
            })}
        {...(trend === undefined ? {} : { trend })}
      />
      <StatTile
        label={t("figures.humanTouched")}
        value={percentText(humanTouchedRate(total))}
        detail={t("figures.humanTouchedDetail", {
          check: total.outcomes["human-check"],
          failed: total.outcomes.failed,
        })}
      />
      <StatTile
        label={t("figures.leadTime")}
        value={total.leadTime === null ? t("notApplicable") : duration(total.leadTime.p50Ms)}
        {...(total.leadTime === null
          ? {}
          : { detail: t("figures.leadTimeP90", { p90: duration(total.leadTime.p90Ms) }) })}
      />
      <StatTile
        label={t("figures.ended")}
        value={total.runs}
        {...(total.outcomes.canceled === 0
          ? {}
          : { detail: t("figures.canceled", { count: total.outcomes.canceled }) })}
      />
    </section>
  );
}

function FailureReasons({ reasons }: { reasons: ReadonlyArray<FailureReasonCount> }) {
  const t = useTranslations("stats.failures");
  const domain = useTranslations("domain");
  const max = Math.max(0, ...reasons.map((r) => r.runs));
  return (
    <ul aria-label={t("listLabel")} {...stylex.props(styles.reasons)}>
      {reasons.map((reason) => (
        <li key={reason.reason} {...stylex.props(styles.reason)}>
          <span {...stylex.props(styles.reasonText)}>
            <Text variant="title">{t(`reasons.${reason.reason}`)}</Text>
            <Text variant="meta">
              {t("prStates", {
                states: PR_STATE_ORDER.filter((state) => reason.prStates[state] > 0)
                  .map((state) =>
                    t("prState", {
                      state: domain(`prState.${state}`),
                      count: reason.prStates[state],
                    }),
                  )
                  .join(t("separator")),
              })}
            </Text>
          </span>
          <FailureBar value={reason.runs} max={max} />
          <Text variant="ui" numeric>
            {t("count", { runs: reason.runs })}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function Breakdown({
  groups,
  dimension,
  days,
  onDimensionChange,
  runsHref,
  onOpenRuns,
}: {
  groups: ReadonlyArray<StatsGroup>;
  dimension: StatsDimension;
  days: number;
  onDimensionChange: (dimension: StatsDimension) => void;
  runsHref?: (key: string) => string;
  onOpenRuns?: (key: string) => void;
}) {
  const t = useTranslations("stats");
  const agentName = useAgentName();
  const nameOf = (group: StatsGroup) => (dimension === "agent" ? agentName(group.key) : group.name);
  return (
    <SegmentedTabs<StatsDimension>
      value={dimension}
      onValueChange={onDimensionChange}
      label={t("dimension.label")}
      items={STATS_DIMENSIONS.map((key) => ({ value: key, label: t(`dimension.${key}`) }))}
      panels={
        <TabPanel value={dimension}>
          <div {...stylex.props(styles.breakdown)}>
            {groups.length === 0 ? (
              <Text variant="meta">{t("empty", { days })}</Text>
            ) : (
              <BreakdownTable
                caption={t("tableCaption", { dimension: t(`dimension.${dimension}`) })}
                groups={groups}
                nameOf={nameOf}
                {...(runsHref === undefined
                  ? {}
                  : { runsHref: (group: StatsGroup) => runsHref(group.key) })}
                {...(onOpenRuns === undefined
                  ? {}
                  : { onOpenRuns: (group: StatsGroup) => onOpenRuns(group.key) })}
              />
            )}
          </div>
        </TabPanel>
      }
    />
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  frame: { containerType: "inline-size" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.s4,
    marginBottom: space.s6,
  },
  headline: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  figures: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      [breakpoints.statTilesStacked]: "repeat(2, minmax(0, 1fr))",
    },
    gap: space.s4,
  },
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    marginTop: space.s10,
  },
  legend: {
    display: "inline-flex",
    flexWrap: "wrap",
    columnGap: space.s4,
    rowGap: space.s1,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  reasons: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr) auto",
    alignItems: "center",
    columnGap: space.s6,
    rowGap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reason: {
    display: "grid",
    gridColumn: "1 / -1",
    gridTemplateColumns: "subgrid",
    alignItems: "center",
  },
  reasonText: { display: "flex", flexDirection: "column", minWidth: 0 },
  breakdown: { marginTop: space.s4 },
});
