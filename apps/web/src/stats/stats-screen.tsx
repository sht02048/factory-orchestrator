import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  FailureBar,
  NoticeLayout,
  OutcomeSwatch,
  PageHeader,
  ScreenLayout,
  Section,
  SegmentedTabs,
  StatTile,
  TabPanel,
  Text,
  TextLink,
} from "@ganger/ui";
import type { StatTrend } from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
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
import { BreakdownTable, isPlainClick } from "./breakdown-table";
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
  failedRunsHref?: (days: StatsPeriodDays) => string;
  onOpenFailedRuns?: (days: StatsPeriodDays) => void;
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
    <ScreenLayout header={<PageHeader title={t("title")} subtitle={t("summary")} />}>
      <NoticeLayout>{body}</NoticeLayout>
    </ScreenLayout>
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
  failedRunsHref,
  onOpenFailedRuns,
  workspaceName,
}: Omit<StatsScreenProps, "page"> & { page: LoadedStatsPage; workspaceName: string }) {
  const t = useTranslations("stats");
  const { statsDay: dayLabel } = useTime();
  const days = page.period.days;

  return (
    <ScreenLayout
      header={
        <PageHeader title={t("title")} subtitle={<Headline total={page.total} days={days} />} />
      }
    >
      <div {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.frame)}>
          <div {...stylex.props(styles.period)}>
            <Text variant="meta" as="p">
              {t("meta", {
                workspace: workspaceName,
                from: dayLabel(page.period.firstDay).long,
                to: dayLabel(page.period.lastDay).long,
              })}
            </Text>
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
          </div>
          <Figures total={page.total} previous={page.previous} days={days} />
          <div {...stylex.props(styles.charts)}>
            <Card label={t("throughput.title")}>
              <div {...stylex.props(styles.chartFrame)}>
                <Section
                  title={t("throughput.title")}
                  titleRole="heading"
                  note={page.total.runs === 0 ? undefined : <Legend placement="head" />}
                >
                  {page.total.runs === 0 ? null : <Legend placement="body" />}
                  <ThroughputChart daily={page.daily} days={days} />
                </Section>
              </div>
            </Card>
            <Card label={t("failures.title")}>
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
                {page.total.outcomes.failed === 0 || failedRunsHref === undefined ? null : (
                  <div {...stylex.props(styles.failedRuns)}>
                    <TextLink
                      href={failedRunsHref(days)}
                      onClick={(event) => {
                        if (onOpenFailedRuns === undefined || !isPlainClick(event)) return;
                        event.preventDefault();
                        onOpenFailedRuns(days);
                      }}
                    >
                      {t("failures.openRuns")}
                    </TextLink>
                  </div>
                )}
              </Section>
            </Card>
          </div>
          <div {...stylex.props(styles.breakdownSection)}>
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
    </ScreenLayout>
  );
}

function Headline({ total, days }: { total: StatsSummary; days: number }) {
  const t = useTranslations("stats.headline");
  const rate = mergedRate(total);
  if (total.runs === 0) return <>{t("empty", { days })}</>;
  if (rate === null) return <>{t("onlyCanceled", { runs: total.runs })}</>;
  return <>{t("rated", { runs: total.rated, percent: rate })}</>;
}

function Legend({ placement }: { placement: "head" | "body" }) {
  const t = useTranslations("stats.throughput.columns");
  return (
    <span
      {...stylex.props(
        styles.legend,
        placement === "head" ? styles.legendInHead : styles.legendInBody,
      )}
    >
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="merged" />
        <Text variant="meta">{t("merged")}</Text>
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="check" />
        <Text variant="meta">{t("check")}</Text>
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="failed" />
        <Text variant="meta">{t("failed")}</Text>
      </span>
      <span {...stylex.props(styles.legendItem)}>
        <OutcomeSwatch tone="canceled" />
        <Text variant="meta">{t("canceled")}</Text>
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
          : {
              detail: t("figures.canceled", { count: total.outcomes.canceled, rated: total.rated }),
            })}
      />
    </section>
  );
}

function FailureReasons({ reasons }: { reasons: ReadonlyArray<FailureReasonCount> }) {
  const t = useTranslations("stats.failures");
  const domain = useTranslations("domain");
  const max = Math.max(0, ...reasons.map((r) => r.runs));
  return (
    <div {...stylex.props(styles.reasonsFrame)}>
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
            <span {...stylex.props(styles.reasonBar)}>
              <FailureBar value={reason.runs} max={max} />
            </span>
            <span {...stylex.props(styles.reasonCount)}>
              <Text variant="ui" numeric>
                {t("count", { runs: reason.runs })}
              </Text>
            </span>
          </li>
        ))}
      </ul>
    </div>
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
              <>
                <span {...stylex.props(styles.scrollHint)}>
                  <Text variant="meta">{t("scrollHint")}</Text>
                </span>
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
                {runsHref === undefined ? null : (
                  <Text variant="meta" as="p">
                    {t("openRunsHint")}
                  </Text>
                )}
              </>
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
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: space.s10,
  },
  frame: { containerType: "inline-size", maxWidth: size.statsPageWidth },
  period: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    marginBottom: space.s4,
  },
  figures: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      [breakpoints.statTilesTwoColumns]: "repeat(2, minmax(0, 1fr))",
      [breakpoints.statTilesStacked]: "minmax(0, 1fr)",
    },
    gap: space.s3,
  },
  charts: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1.4fr) minmax(0, 1fr)",
      [breakpoints.statsChartsStacked]: "minmax(0, 1fr)",
    },
    gap: space.s5,
    marginTop: space.s6,
  },
  breakdownSection: { marginTop: space.s10 },
  failedRuns: { marginTop: space.s4 },
  legend: {
    display: "inline-flex",
    flexWrap: "wrap",
    columnGap: space.s4,
    rowGap: space.s1,
  },
  legendInHead: { display: { default: "inline-flex", [breakpoints.statsLegendBelow]: "none" } },
  legendInBody: {
    display: { default: "none", [breakpoints.statsLegendBelow]: "flex" },
    marginBottom: space.s2,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  scrollHint: { display: { default: "none", [breakpoints.statsBreakdownScrolls]: "block" } },
  chartFrame: { containerType: "inline-size" },
  reasonsFrame: { containerType: "inline-size" },
  reasons: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) min(${size.failureBarWidth}, 40%) auto`,
      [breakpoints.failureBarsBelow]: "minmax(0, 1fr) auto",
    },
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reason: {
    display: "grid",
    gridColumn: "1 / -1",
    gridTemplateColumns: "subgrid",
    gridTemplateAreas: {
      default: '"text bar count"',
      [breakpoints.failureBarsBelow]: '"text count" "bar bar"',
    },
    alignItems: "center",
    rowGap: space.s2,
  },
  reasonText: { gridArea: "text", display: "flex", flexDirection: "column", minWidth: 0 },
  reasonBar: { gridArea: "bar", display: "flex" },
  reasonCount: { gridArea: "count", justifySelf: "end" },
  breakdown: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    marginTop: space.s4,
  },
});
