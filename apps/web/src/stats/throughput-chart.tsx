import * as stylex from "@stylexjs/stylex";
import { Button, Text } from "@factory/ui";
import { colors, fontSize, fontWeight, space } from "@factory/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { STATS_DAYS } from "./model";
import type { DailyThroughput } from "./model";

// 막대 영역 높이(px). 축 글자는 HTML 이라 화면 폭과 상관없이 제 크기로 보인다.
const PLOT_HEIGHT = 136;
const GRID_LINES = 4;

type Outcome = "merged" | "check" | "failed" | "canceled";

/**
 * 날짜별 처리량: 날마다 끝난 런 수를 요약 결과로 나눠 쌓는다(아래부터 Merged, Human Check, Failed, Canceled).
 * 색은 상태 알약과 같은 뜻을 쓴다(ADR 0010 5번): Merged 파랑, Human Check 노랑, Failed 빨강, Canceled 회색.
 * Canceled 는 Failed 와 밝기가 비슷해 빗금을 더한다. Canceled 도 따로 세어 쌓는다(Q82.18).
 *
 * 같은 값을 표로도 둔다. 표는 늘 접근성 트리에 있고, "표로 보기"를 누르면 화면에도 보인다.
 * 막대 그림은 role="img" 라 날짜별 값은 표로 읽는다.
 */
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

  // 눈금은 짝수 간격 네 칸.
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
                        style={{ height: `${(segment.value / top) * 100}%` }}
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
      {/* 표 요소는 width·height 를 최소값으로만 받아, 숨길 때는 감싼 div 를 줄인다 */}
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

/** 범례의 색 견본. 막대와 같은 색과 빗금이다 */
export function LegendSwatch({ outcome }: { outcome: Outcome }) {
  return <i aria-hidden {...stylex.props(styles.swatch, fill[outcome])} />;
}

// Canceled 빗금: 회색 바탕 위에 바탕색 줄을 긋는다.
const hatch = `repeating-linear-gradient(135deg, transparent 0 2px, ${colors.bgCanvas} 2px 3px)`;

const styles = stylex.create({
  chart: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gridTemplateRows: `${PLOT_HEIGHT}px auto`,
    columnGap: space.px6,
    rowGap: space.px6,
    // 맨 위 눈금 글자가 위로 반쯤 나온다.
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
    // 큰 값 옆의 1런 조각도 보이게 한다.
    minHeight: 2,
    marginTop: 1,
    borderRadius: 1,
    flexShrink: 0,
  },
  days: { gridColumn: 2, display: "grid" },
  // 칸보다 긴 날짜는 양옆 빈 칸으로 넘친다(날짜는 두 칸에 하나만 쓴다).
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
  // 화면에는 숨기고 접근성 트리에는 남긴다.
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
