import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  PageHeader,
  PanelBlock,
  PanelHeader,
  RowTitle,
  Section,
  SplitView,
  Tab,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Tabs,
  Text,
} from "@factory/ui";
import { colors, fontSize, fontWeight, lineHeight, space } from "@factory/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import type { WorkspaceSummary } from "../shell/model";
import { STATS_DAYS, STATS_DIMENSIONS, percent } from "./model";
import type {
  FailedCombination,
  StatsDimension,
  StatsGroup,
  StatsPage,
  StatsSummary,
} from "./model";
import { LegendSwatch, ThroughputChart } from "./throughput-chart";

// 이름 | 런 | Merged(%) | Human Check | Failed | Canceled | 리드 타임(중앙값)
const columns = "minmax(0, 1fr) 56px 72px 104px 64px 56px 88px";

export interface StatsScreenProps {
  page: StatsPage;
  /** "전체"에서 고를 Workspace 들 */
  workspaces: ReadonlyArray<WorkspaceSummary>;
  dimension: StatsDimension;
  /** 고른 묶음. 없거나 목록에 없으면 첫 행을 고른다 */
  selectedKey: string | undefined;
  onDimensionChange: (dimension: StatsDimension) => void;
  onSelect: (key: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
}

/** Stats: 기간 요약, 날짜별 처리량, Failed 조합, 나눠 보기 목록 + 오른쪽 상세 패널(ADR 0007, 시안 B) */
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
    <div {...stylex.props(styles.notice)}>
      <PageHeader title={t("title")} subtitle={t("summary")} />
      {body}
    </div>
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
  selectedKey,
  onDimensionChange,
  onSelect,
  workspaceName,
}: Omit<StatsScreenProps, "page"> & { page: LoadedStatsPage; workspaceName: string }) {
  const groupName = useGroupName(dimension);
  const t = useTranslations("stats");
  const { statsDay: dayLabel, duration } = useTime();
  const groups = page.groups[dimension];
  const selected = groups.find((g) => g.key === selectedKey) ?? groups[0];

  return (
    <SplitView
      list={
        <>
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", {
              workspace: workspaceName,
              days: STATS_DAYS,
              from: dayLabel(page.period.firstDay).long,
              to: dayLabel(page.period.lastDay).long,
            })}
          />
          <Figures total={page.total} />
          <Section
            title={t("throughput.title")}
            // 끝난 런이 없으면 차트 대신 문구만 보여 범례도 뺀다.
            note={
              page.total.runs === 0 ? undefined : (
                <span {...stylex.props(styles.legend)}>
                  <span {...stylex.props(styles.legendItem)}>
                    <LegendSwatch outcome="merged" />
                    {t("columns.merged")}
                  </span>
                  <span {...stylex.props(styles.legendItem)}>
                    <LegendSwatch outcome="check" />
                    {t("columns.check")}
                  </span>
                  <span {...stylex.props(styles.legendItem)}>
                    <LegendSwatch outcome="failed" />
                    {t("columns.failed")}
                  </span>
                  <span {...stylex.props(styles.legendItem)}>
                    <LegendSwatch outcome="canceled" />
                    {t("columns.canceled")}
                  </span>
                </span>
              )
            }
          >
            <ThroughputChart daily={page.daily} />
          </Section>
          <Section
            title={t("failedCombinations.title")}
            count={page.total.outcomes.failed}
            note={t("failedCombinations.note")}
          >
            {page.total.failedCombinations.length === 0 ? (
              <Text variant="meta">{t("failedCombinations.empty")}</Text>
            ) : (
              <FailedCombinations combinations={page.total.failedCombinations} />
            )}
          </Section>
          <div {...stylex.props(styles.breakdown)}>
            <Tabs<StatsDimension>
              value={dimension}
              onValueChange={onDimensionChange}
              label={t("dimension.label")}
            >
              {STATS_DIMENSIONS.map((key) => (
                <Tab key={key} value={key}>
                  {t(`dimension.${key}`)}
                </Tab>
              ))}
            </Tabs>
            <Table columns={columns}>
              <TableHead>
                <TableHeader>{t("columns.name")}</TableHeader>
                <TableHeader align="end">{t("columns.runs")}</TableHeader>
                <TableHeader align="end">{t("columns.merged")}</TableHeader>
                <TableHeader align="end">{t("columns.check")}</TableHeader>
                <TableHeader align="end">{t("columns.failed")}</TableHeader>
                <TableHeader align="end">{t("columns.canceled")}</TableHeader>
                <TableHeader align="end">{t("columns.leadTime")}</TableHeader>
              </TableHead>
              {groups.length === 0 ? (
                <TableEmpty>{t("empty", { days: STATS_DAYS })}</TableEmpty>
              ) : (
                <TableRows
                  label={t("listLabel", { dimension: t(`dimension.${dimension}`) })}
                  value={selected?.key ?? null}
                  onValueChange={onSelect}
                >
                  {groups.map((group) => (
                    <TableRow key={group.key} value={group.key} label={groupName(group)}>
                      <TableCell>
                        <RowTitle>{groupName(group)}</RowTitle>
                      </TableCell>
                      <TableCell align="end" numeric>
                        {group.runs}
                      </TableCell>
                      <TableCell align="end" numeric>
                        <PercentText part={group.outcomes.merged} whole={group.rated} />
                      </TableCell>
                      <TableCell align="end" numeric>
                        {group.outcomes["human-check"]}
                      </TableCell>
                      <TableCell align="end" numeric>
                        {group.outcomes.failed}
                      </TableCell>
                      <TableCell align="end" numeric>
                        {group.outcomes.canceled}
                      </TableCell>
                      <TableCell align="end" numeric>
                        {group.durations === null
                          ? t("notApplicable")
                          : duration(group.durations.leadP50Ms)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableRows>
              )}
            </Table>
          </div>
        </>
      }
      panel={
        selected === undefined ? null : (
          <section aria-label={t("panel.label")}>
            <GroupPanel group={selected} dimension={dimension} />
          </section>
        )
      }
    />
  );
}

function PercentText({ part, whole }: { part: number; whole: number }) {
  const t = useTranslations("stats");
  const value = percent(part, whole);
  return <>{value === null ? t("notApplicable") : t("percent", { percent: value })}</>;
}

function Figures({ total }: { total: StatsSummary }) {
  const t = useTranslations("stats");
  const { duration } = useTime();
  const check = total.humanCheck;
  const mergedAfterCheck = percent(check.merged, check.humanCheck);
  return (
    <section aria-label={t("figures.label")} {...stylex.props(styles.figures)}>
      <Figure
        value={total.runs}
        label={
          total.outcomes.canceled === 0 ? (
            t("figures.ended")
          ) : (
            <>
              {t("figures.ended")}
              <br />
              {t("figures.canceled", { count: total.outcomes.canceled })}
            </>
          )
        }
      />
      <Figure
        value={<PercentText part={total.outcomes.merged} whole={total.rated} />}
        label={t("figures.merged")}
      />
      <Figure
        value={total.outcomes["human-check"] + total.outcomes.failed}
        label={
          <>
            {t.rich("figures.attention", {
              check: (chunks) => <span {...stylex.props(styles.checkText)}>{chunks}</span>,
              failed: (chunks) => <span {...stylex.props(styles.failedText)}>{chunks}</span>,
              checkCount: total.outcomes["human-check"],
              failedCount: total.outcomes.failed,
            })}
          </>
        }
      />
      <Figure
        value={total.durations === null ? t("notApplicable") : duration(total.durations.leadP50Ms)}
        label={
          total.durations === null ? (
            t("figures.leadTime", { p90: t("notApplicable") })
          ) : (
            <>
              {t("figures.leadTime", { p90: duration(total.durations.leadP90Ms) })}
              <br />
              {t("figures.leadTimeSplit", {
                wait: duration(total.durations.waitP50Ms),
                execution: duration(total.durations.executionP50Ms),
              })}
            </>
          )
        }
      />
      <Figure
        value={
          mergedAfterCheck === null
            ? t("notApplicable")
            : t("percent", { percent: mergedAfterCheck })
        }
        label={
          <>
            {t("figures.mergedAfterCheck")}
            <br />
            {t("figures.mergedAfterCheckOf", { total: check.humanCheck, merged: check.merged })}
          </>
        }
      />
    </section>
  );
}

function Figure({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div>
      <span {...stylex.props(styles.figureValue)}>{value}</span>
      <span {...stylex.props(styles.figureLabel)}>{label}</span>
    </div>
  );
}

/** 묶음 이름. 에이전트는 ID 대신 공용 에이전트 이름으로 보인다 */
function useGroupName(dimension: StatsDimension): (group: StatsGroup) => string {
  const agentName = useAgentName();
  return (group) => (dimension === "agent" ? agentName(group.key) : group.name);
}

/** Failed 조합 목록. 조합 이름이 길어 정의 목록의 고정 라벨 폭 대신 내용 폭에 맞춘다 */
function FailedCombinations({ combinations }: { combinations: ReadonlyArray<FailedCombination> }) {
  const t = useTranslations("stats.failedCombinations");
  const domain = useTranslations("domain");
  return (
    <dl {...stylex.props(styles.combinations)}>
      {combinations.map((c) => (
        <div key={`${c.agentResult}-${c.prState}`} {...stylex.props(styles.combination)}>
          <dt {...stylex.props(styles.combinationName)}>
            {t("combination", {
              agentResult: domain(`agentResult.${c.agentResult}`),
              prState: domain(`prState.${c.prState}`),
            })}
          </dt>
          <dd {...stylex.props(styles.combinationCount)}>{t("count", { runs: c.runs })}</dd>
        </div>
      ))}
    </dl>
  );
}

function GroupPanel({ group, dimension }: { group: StatsGroup; dimension: StatsDimension }) {
  const groupName = useGroupName(dimension);
  const t = useTranslations("stats");
  const { duration } = useTime();
  const { outcomes, humanCheck, durations } = group;
  // 비율은 취소를 뺀 런으로 나눈다(Q82.9·Q82.18). 취소는 개수만 보인다.
  const share = (count: number) => {
    const value = percent(count, group.rated);
    return value === null
      ? t("panel.count", { count })
      : t("panel.countPercent", { count, percent: value });
  };
  const mergedAfterCheck = percent(humanCheck.merged, humanCheck.humanCheck);

  return (
    <DetailPanel>
      <PanelHeader
        status={
          <Text variant="meta">
            {t("panel.context", { dimension: t(`dimension.${dimension}`), days: STATS_DAYS })}
          </Text>
        }
        title={groupName(group)}
        reason={
          group.rated === 0
            ? t("panel.whyOnlyCanceled", { canceled: outcomes.canceled })
            : outcomes.canceled === 0
              ? t("panel.why", {
                  runs: group.rated,
                  merged: outcomes.merged,
                  attention: outcomes["human-check"] + outcomes.failed,
                })
              : t("panel.whyWithCanceled", {
                  runs: group.rated,
                  merged: outcomes.merged,
                  attention: outcomes["human-check"] + outcomes.failed,
                  canceled: outcomes.canceled,
                })
        }
      />
      <DefinitionList>
        <DefinitionItem label={t("panel.runs")}>{group.runs}</DefinitionItem>
        <DefinitionItem label={t("panel.merged")}>{share(outcomes.merged)}</DefinitionItem>
        <DefinitionItem label={t("panel.check")}>
          <span {...stylex.props(outcomes["human-check"] > 0 && styles.checkText)}>
            {share(outcomes["human-check"])}
          </span>
        </DefinitionItem>
        <DefinitionItem label={t("panel.failed")}>
          <span {...stylex.props(outcomes.failed > 0 && styles.failedText)}>
            {share(outcomes.failed)}
          </span>
        </DefinitionItem>
        <DefinitionItem label={t("panel.canceled")}>
          {t("panel.canceledCount", { count: outcomes.canceled })}
        </DefinitionItem>
        <DefinitionItem label={t("panel.leadTime")}>
          {durations === null ? t("notApplicable") : duration(durations.leadP50Ms)}
        </DefinitionItem>
        <DefinitionItem label={t("panel.leadTimeP90")}>
          {durations === null ? t("notApplicable") : duration(durations.leadP90Ms)}
        </DefinitionItem>
        <DefinitionItem label={t("panel.wait")}>
          {durations === null ? t("notApplicable") : duration(durations.waitP50Ms)}
        </DefinitionItem>
        <DefinitionItem label={t("panel.execution")}>
          {durations === null ? t("notApplicable") : duration(durations.executionP50Ms)}
        </DefinitionItem>
        <DefinitionItem label={t("panel.mergedAfterCheck")} empty={mergedAfterCheck === null}>
          {mergedAfterCheck === null
            ? t("panel.noHumanCheck")
            : t("panel.mergedAfterCheckValue", {
                merged: humanCheck.merged,
                total: humanCheck.humanCheck,
                percent: mergedAfterCheck,
              })}
        </DefinitionItem>
      </DefinitionList>
      <PanelBlock title={t("panel.failedCombinations")}>
        {group.failedCombinations.length === 0 ? (
          <Text variant="meta">{t("panel.noFailed")}</Text>
        ) : (
          <FailedCombinations combinations={group.failedCombinations} />
        )}
      </PanelBlock>
    </DetailPanel>
  );
}

const styles = stylex.create({
  notice: {
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  figures: {
    display: "grid",
    // 좁은 폭에서는 다음 줄로 접는다.
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: space.s6,
    marginBottom: space.s10,
  },
  figureValue: {
    display: "block",
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
    lineHeight: lineHeight.tight,
  },
  figureLabel: {
    display: "block",
    marginTop: space.s1,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.snug,
  },
  breakdown: { marginTop: space.s10 },
  legend: {
    display: "inline-flex",
    flexWrap: "wrap",
    columnGap: space.s4,
    rowGap: space.s1,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  combinations: {
    display: "grid",
    gridTemplateColumns: "max-content max-content",
    rowGap: space.s2,
    columnGap: space.s6,
    margin: 0,
  },
  combination: { display: "contents" },
  combinationName: { color: colors.textSecondary },
  combinationCount: {
    margin: 0,
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
  },
  checkText: { color: colors.check },
  failedText: { color: colors.problem },
});
