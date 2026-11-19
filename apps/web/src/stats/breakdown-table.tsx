import * as stylex from "@stylexjs/stylex";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  linkStyles,
} from "@ganger/ui";
import { size } from "@ganger/ui/tokens.stylex";
import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { HorizontalScroll } from "./horizontal-scroll";
import { mergedRate } from "@ganger/app/stats/model";
import type { StatsGroup } from "@ganger/app/stats/model";

const BREAKDOWN_COLUMN_WIDTHS = [
  null,
  `max(${size.statsCountColumn}, 14%)`,
  `max(${size.statsCountColumn}, 14%)`,
  `max(${size.statsDurationColumn}, 18%)`,
] as const;

export function BreakdownTable({
  caption,
  groups,
  nameOf,
  runsHref,
  onOpenRuns,
}: {
  caption: string;
  groups: ReadonlyArray<StatsGroup>;
  nameOf: (group: StatsGroup) => string;
  runsHref?: (group: StatsGroup) => string;
  onOpenRuns?: (group: StatsGroup) => void;
}) {
  const t = useTranslations("stats");
  const { duration } = useTime();
  return (
    <HorizontalScroll label={caption} minWidth={size.statsBreakdownMinWidth}>
      <DataTable caption={caption} captionHidden fixed columnWidths={BREAKDOWN_COLUMN_WIDTHS}>
        <DataTableHead>
          <DataTableHeader>{t("columns.name")}</DataTableHeader>
          <DataTableHeader align="end">{t("columns.runs")}</DataTableHeader>
          <DataTableHeader align="end">{t("columns.mergedRate")}</DataTableHeader>
          <DataTableHeader align="end">{t("columns.leadTime")}</DataTableHeader>
        </DataTableHead>
        <DataTableBody>
          {groups.map((group) => {
            const rate = mergedRate(group);
            return (
              <DataTableRow
                key={group.key}
                {...(onOpenRuns === undefined
                  ? {}
                  : {
                      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                        if (event.target instanceof Element && event.target.closest("a") !== null)
                          return;
                        if ((window.getSelection()?.toString() ?? "") !== "") return;
                        onOpenRuns(group);
                      },
                    })}
              >
                <DataTableRowHeader strong>
                  {runsHref === undefined ? (
                    <span {...stylex.props(styles.name)}>{nameOf(group)}</span>
                  ) : (
                    <a
                      href={runsHref(group)}
                      aria-label={t("openRuns", { name: nameOf(group) })}
                      onClick={(event) => {
                        if (onOpenRuns === undefined || !isPlainClick(event)) return;
                        event.preventDefault();
                        onOpenRuns(group);
                      }}
                      {...stylex.props(linkStyles("plain"), styles.name)}
                    >
                      {nameOf(group)}
                    </a>
                  )}
                </DataTableRowHeader>
                <DataTableCell align="end" numeric>
                  {group.runs}
                </DataTableCell>
                <DataTableCell align="end" numeric>
                  {rate === null ? t("notApplicable") : t("percent", { percent: rate })}
                </DataTableCell>
                <DataTableCell align="end" numeric>
                  {group.leadTime === null ? t("notApplicable") : duration(group.leadTime.p50Ms)}
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTableBody>
      </DataTable>
    </HorizontalScroll>
  );
}

const styles = stylex.create({
  name: { overflowWrap: "anywhere" },
});

export function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
