import * as stylex from "@stylexjs/stylex";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  OutcomeBar,
  linkStyles,
} from "@ganger/ui";
import type { OutcomeSegment } from "@ganger/ui";
import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { OutcomeCounts, StatsGroup } from "./model";

export function outcomeSegments(outcomes: OutcomeCounts): ReadonlyArray<OutcomeSegment> {
  return [
    { tone: "merged", value: outcomes.merged },
    { tone: "check", value: outcomes["human-check"] },
    { tone: "failed", value: outcomes.failed },
    { tone: "canceled", value: outcomes.canceled },
  ];
}

export function useOutcomeLabel(): (outcomes: OutcomeCounts) => string {
  const t = useTranslations("stats");
  return (outcomes) =>
    t("result", {
      merged: outcomes.merged,
      check: outcomes["human-check"],
      failed: outcomes.failed,
      canceled: outcomes.canceled,
    });
}

const BREAKDOWN_COLUMN_WIDTHS = [null, "10%", "40%", "16%"] as const;

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
  const outcomeLabel = useOutcomeLabel();
  return (
    <DataTable caption={caption} captionHidden fixed columnWidths={BREAKDOWN_COLUMN_WIDTHS}>
      <DataTableHead>
        <DataTableHeader>{t("columns.name")}</DataTableHeader>
        <DataTableHeader align="end">{t("columns.runs")}</DataTableHeader>
        <DataTableHeader>{t("columns.result")}</DataTableHeader>
        <DataTableHeader align="end">{t("columns.leadTime")}</DataTableHeader>
      </DataTableHead>
      <DataTableBody>
        {groups.map((group) => (
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
            <DataTableRowHeader strong truncate>
              {runsHref === undefined ? (
                nameOf(group)
              ) : (
                <a
                  href={runsHref(group)}
                  aria-label={t("openRuns", { name: nameOf(group) })}
                  onClick={(event) => {
                    if (onOpenRuns === undefined || !isPlainClick(event)) return;
                    event.preventDefault();
                    onOpenRuns(group);
                  }}
                  {...stylex.props(linkStyles("plain"))}
                >
                  {nameOf(group)}
                </a>
              )}
            </DataTableRowHeader>
            <DataTableCell align="end" numeric>
              {group.runs}
            </DataTableCell>
            <DataTableCell>
              <OutcomeBar
                segments={outcomeSegments(group.outcomes)}
                label={outcomeLabel(group.outcomes)}
              />
            </DataTableCell>
            <DataTableCell align="end" numeric>
              {group.leadTime === null ? t("notApplicable") : duration(group.leadTime.p50Ms)}
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
