import * as stylex from "@stylexjs/stylex";
import {
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  StackedBarChart,
  Text,
  visuallyHiddenStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { DailyThroughput } from "./model";
import { outcomeSegments } from "./outcome-bar";

const GRID_LINES = 4;
const MAX_DAY_LABELS = 8;

export function dayLabelShown(index: number, days: number): boolean {
  const every = Math.ceil(days / MAX_DAY_LABELS);
  return (days - 1 - index) % every === 0;
}

export function ThroughputChart({
  daily,
  days,
}: {
  daily: ReadonlyArray<DailyThroughput>;
  days: number;
}) {
  const t = useTranslations("stats.throughput");
  const { statsDay: dayLabel } = useTime();
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const totals = daily.map(
    (d) => d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed + d.outcomes.canceled,
  );
  const max = Math.max(0, ...totals);

  if (max === 0) return <Text variant="meta">{t("empty", { days })}</Text>;

  const step = Math.max(1, Math.ceil(max / GRID_LINES / 2) * 2);
  const top = step * GRID_LINES;
  const ticks = Array.from({ length: GRID_LINES + 1 }, (_, i) => i * step);
  const lastIndex = daily.length - 1;

  return (
    <div>
      <StackedBarChart
        label={t("chartLabel")}
        detailsId={tableId}
        ticks={ticks}
        top={top}
        bars={daily.map((d) => ({
          key: String(d.day),
          title: t("day", {
            day: dayLabel(d.day).long,
            merged: d.outcomes.merged,
            check: d.outcomes["human-check"],
            failed: d.outcomes.failed,
            canceled: d.outcomes.canceled,
          }),
          segments: outcomeSegments(d.outcomes),
        }))}
        barLabels={daily.map((d, i) =>
          i === lastIndex
            ? t("today")
            : dayLabelShown(i, daily.length)
              ? dayLabel(d.day).short
              : null,
        )}
      />
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" onClick={() => setShowTable((shown) => !shown)}>
          {showTable ? t("hideTable") : t("showTable")}
        </Button>
      </div>
      <div {...stylex.props(styles.table, !showTable && visuallyHiddenStyles.hidden)}>
        <DataTable id={tableId} caption={t("tableCaption")} density="compact">
          <DataTableHead>
            <DataTableHeader>{t("columns.day")}</DataTableHeader>
            <DataTableHeader align="end">{t("columns.merged")}</DataTableHeader>
            <DataTableHeader align="end">{t("columns.check")}</DataTableHeader>
            <DataTableHeader align="end">{t("columns.failed")}</DataTableHeader>
            <DataTableHeader align="end">{t("columns.canceled")}</DataTableHeader>
          </DataTableHead>
          <DataTableBody>
            {daily.map((d) => (
              <DataTableRow key={d.day}>
                <DataTableRowHeader>{dayLabel(d.day).long}</DataTableRowHeader>
                <DataTableCell align="end">{d.outcomes.merged}</DataTableCell>
                <DataTableCell align="end">{d.outcomes["human-check"]}</DataTableCell>
                <DataTableCell align="end">{d.outcomes.failed}</DataTableCell>
                <DataTableCell align="end">{d.outcomes.canceled}</DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </div>
    </div>
  );
}

const styles = stylex.create({
  actions: { display: "flex", justifyContent: "flex-end", marginTop: space.s2 },
  table: { marginTop: space.s2 },
});
