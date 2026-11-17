import * as stylex from "@stylexjs/stylex";
import { colors, fontSize } from "@factory/ui/tokens.stylex";
import { useTranslations } from "use-intl";
import type { DailyThroughput } from "./model";
import { useDayLabel } from "./dates";

// 시안 B(stats.html)의 막대 그래프 크기. viewBox 단위이고 화면 폭에 맞춰 늘고 준다.
const WIDTH = 720;
const HEIGHT = 168;
const TOP = 8;
const BOTTOM = 22;
const LEFT = 24;
const GRID_LINES = 4;

/**
 * 날짜별 처리량: 날마다 끝난 런 수를 요약 결과로 나눠 쌓는다(아래부터 Merged, Human Check, Failed).
 * 색은 손댈 일(Human Check, Failed)에만 쓰고 Merged 는 무채색이다(ADR 0007).
 */
export function ThroughputChart({ daily }: { daily: ReadonlyArray<DailyThroughput> }) {
  const t = useTranslations("stats.throughput");
  const dayLabel = useDayLabel();
  const totals = daily.map(
    (d) => d.outcomes.merged + d.outcomes["human-check"] + d.outcomes.failed,
  );
  const max = Math.max(0, ...totals);
  // 눈금은 짝수 간격 네 칸. 런이 없어도 0~4 눈금을 그린다.
  const step = Math.max(1, Math.ceil(max / GRID_LINES / 2) * 2);
  const scale = (HEIGHT - TOP - BOTTOM) / (step * GRID_LINES);
  const barSlot = (WIDTH - LEFT) / Math.max(1, daily.length);
  const barWidth = barSlot * 0.56;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t("chartLabel")}
      {...stylex.props(styles.chart)}
    >
      {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
        const y = HEIGHT - BOTTOM - i * step * scale;
        return (
          <g key={`grid-${i}`}>
            <line x1={LEFT} x2={WIDTH} y1={y} y2={y} {...stylex.props(styles.grid)} />
            <text x={0} y={y + 4} {...stylex.props(styles.text)}>
              {i * step}
            </text>
          </g>
        );
      })}
      {daily.map((d, i) => {
        const x = LEFT + i * barSlot + barSlot * 0.22;
        const segments = [
          { key: "merged", value: d.outcomes.merged, style: styles.merged },
          { key: "check", value: d.outcomes["human-check"], style: styles.check },
          { key: "failed", value: d.outcomes.failed, style: styles.failed },
        ];
        let y = HEIGHT - BOTTOM;
        const label = dayLabel(d.day);
        return (
          <g key={d.day}>
            <title>
              {t("day", {
                day: label.long,
                merged: d.outcomes.merged,
                check: d.outcomes["human-check"],
                failed: d.outcomes.failed,
              })}
            </title>
            {segments.map((segment) => {
              if (segment.value === 0) return null;
              const h = segment.value * scale;
              y -= h;
              return (
                <rect
                  key={segment.key}
                  x={x}
                  y={y + 1}
                  width={barWidth}
                  height={Math.max(0, h - 1)}
                  rx={1}
                  {...stylex.props(segment.style)}
                />
              );
            })}
            {i % 2 === 1 || i === daily.length - 1 ? (
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
                {...stylex.props(styles.text)}
              >
                {label.short}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** 범례의 색 견본. 막대와 같은 색이다 */
export function LegendSwatch({ outcome }: { outcome: "merged" | "check" | "failed" }) {
  return <i aria-hidden {...stylex.props(styles.swatch, swatchFill[outcome])} />;
}

const styles = stylex.create({
  chart: { display: "block", width: "100%", height: "auto", overflow: "visible" },
  grid: { stroke: colors.borderSubtle },
  text: {
    fill: colors.textTertiary,
    fontSize: fontSize.label,
    fontVariantNumeric: "tabular-nums",
  },
  merged: { fill: colors.textDisabled },
  check: { fill: colors.check },
  failed: { fill: colors.failed },
  swatch: { display: "inline-block", width: 8, height: 8, borderRadius: 2 },
});

const swatchFill = stylex.create({
  merged: { backgroundColor: colors.textDisabled },
  check: { backgroundColor: colors.check },
  failed: { backgroundColor: colors.failed },
});
