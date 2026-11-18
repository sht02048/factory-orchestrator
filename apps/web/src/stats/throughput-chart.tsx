import * as stylex from "@stylexjs/stylex";
import { Button, Text } from "@factory/ui";
import { colors, fontSize, fontWeight, space } from "@factory/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { STATS_DAYS } from "./model";
import type { DailyThroughput } from "./model";

const PLOT_HEIGHT = 136;
const GRID_LINES = 4;

type Outcome = "merged" | "check" | "failed" | "canceled";

export function ThroughputChart({ daily }: { daily: ReadonlyArray<DailyThroughput> }) {
  const t = useTranslations("stats.throughput");
  const { statsDay: dayLabel } = useTime();
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const totals = daily.map(
    (d) => d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed + d.outcomes.canceled,
  );
  const max = Math.max(0, ...totals);

  if (max === 0) return <Text variant="meta">{t("empty", { days: STATS_DAYS })}</Text>;

  const step = Math.max(1, Math.ceil(max / GRID_LINES / 2) * 2);
  const top = step * GRID_LINES;
  const ticks = Array.from({ length: GRID_LINES + 1 }, (_, i) => i * step);
  const columns = `repeat(${daily.length}, minmax(0, 1fr))`;

  return (
    <div>
      <div
        role="img"
        aria-label={t("chartLabel")}
        aria-details={tableId}
        {...stylex.props(styles.chart)}
      >
        <div {...stylex.props(styles.axis)}>
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{ bottom: `${(tick / top) * 100}%` }}
              {...stylex.props(styles.text, styles.tick)}
            >
              {tick}
            </span>
          ))}
        </div>
        <div {...stylex.props(styles.plot)}>
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{ bottom: `${(tick / top) * 100}%` }}
              {...stylex.props(styles.grid)}
            />
          ))}
          <div style={{ gridTemplateColumns: columns }} {...stylex.props(styles.bars)}>
            {daily.map((d) => {
              const segments: ReadonlyArray<{ key: Outcome; value: number }> = [
                { key: "merged", value: d.outcomes.merged },
                { key: "check", value: d.outcomes["human-check"] },
                { key: "failed", value: d.outcomes.failed },
                { key: "canceled", value: d.outcomes.canceled },
              ];
              return (
                <div
                  key={d.day}
                  title={t("day", {
                    day: dayLabel(d.day).long,
                    merged: d.outcomes.merged,
                    check: d.outcomes["human-check"],
                    failed: d.outcomes.failed,
                    canceled: d.outcomes.canceled,
                  })}
                  {...stylex.props(styles.bar)}
                >
                  {segments.map((segment) =>
                    segment.value === 0 ? null : (
                      <span
                        key={segment.key}
                        style={{ height: `calc(${(segment.value / top) * 100}% - 1px)` }}
                        {...stylex.props(styles.segment, fill[segment.key])}
                      />
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ gridTemplateColumns: columns }} {...stylex.props(styles.days)}>
          {daily.map((d, i) => (
            <span key={d.day} {...stylex.props(styles.text, styles.day)}>
              {i % 2 === 1 || i === daily.length - 1 ? dayLabel(d.day).short : null}
            </span>
          ))}
        </div>
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" onClick={() => setShowTable((shown) => !shown)}>
          {showTable ? t("hideTable") : t("showTable")}
        </Button>
      </div>
      <div {...stylex.props(!showTable && styles.hidden)}>
        <table id={tableId} {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>{t("tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(styles.th)}>
                {t("columns.day")}
              </th>
              <th scope="col" {...stylex.props(styles.th, styles.end)}>
                {t("columns.merged")}
              </th>
              <th scope="col" {...stylex.props(styles.th, styles.end)}>
                {t("columns.check")}
              </th>
              <th scope="col" {...stylex.props(styles.th, styles.end)}>
                {t("columns.failed")}
              </th>
              <th scope="col" {...stylex.props(styles.th, styles.end)}>
                {t("columns.canceled")}
              </th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day}>
                <th scope="row" {...stylex.props(styles.td, styles.rowHead)}>
                  {dayLabel(d.day).long}
                </th>
                <td {...stylex.props(styles.td, styles.end)}>{d.outcomes.merged}</td>
                <td {...stylex.props(styles.td, styles.end)}>{d.outcomes["human-check"]}</td>
                <td {...stylex.props(styles.td, styles.end)}>{d.outcomes.failed}</td>
                <td {...stylex.props(styles.td, styles.end)}>{d.outcomes.canceled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LegendSwatch({ outcome }: { outcome: Outcome }) {
  return <i aria-hidden {...stylex.props(styles.swatch, fill[outcome])} />;
}

const hatch = `repeating-linear-gradient(135deg, transparent 0 2px, ${colors.bgCanvas} 2px 3px)`;

const styles = stylex.create({
  chart: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gridTemplateRows: `${PLOT_HEIGHT}px auto`,
    columnGap: space.px6,
    rowGap: space.px6,
    paddingTop: space.s2,
  },
  axis: { position: "relative", minWidth: space.s4 },
  tick: {
    position: "absolute",
    insetInlineEnd: 0,
    transform: "translateY(50%)",
    lineHeight: 1,
  },
  plot: { position: "relative" },
  grid: {
    position: "absolute",
    insetInline: 0,
    height: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  bars: { position: "absolute", inset: 0, display: "grid" },
  bar: {
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "center",
    minWidth: 0,
  },
  segment: {
    display: "block",
    width: "56%",
    minHeight: 2,
    marginTop: 1,
    borderRadius: 1,
    flexShrink: 0,
  },
  days: { gridColumn: 2, display: "grid" },
  day: { display: "flex", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" },
  text: {
    color: colors.textTertiary,
    fontSize: fontSize.label,
    fontVariantNumeric: "tabular-nums",
  },
  actions: { display: "flex", justifyContent: "flex-end", marginTop: space.s2 },
  table: {
    width: "100%",
    marginTop: space.s2,
    borderCollapse: "collapse",
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  caption: {
    textAlign: "start",
    paddingBottom: space.s1,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  th: {
    paddingBlock: space.s1,
    paddingInline: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    textAlign: "start",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  td: {
    paddingBlock: space.s1,
    paddingInline: space.s2,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  rowHead: { color: colors.textSecondary, fontWeight: fontWeight.regular, textAlign: "start" },
  end: { textAlign: "end" },
  swatch: { display: "inline-block", width: 8, height: 8, borderRadius: 2 },
});

const fill = stylex.create({
  merged: { backgroundColor: colors.merged },
  check: { backgroundColor: colors.check },
  failed: { backgroundColor: colors.problem },
  canceled: { backgroundColor: colors.idle, backgroundImage: hatch },
});
