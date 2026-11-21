import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { breakpoints, colors, radius, space } from "../tokens.stylex";
import { textStyles } from "./text";

export const OUTCOME_TONES = ["succeeded", "failed", "canceled"] as const;

export type OutcomeTone = (typeof OUTCOME_TONES)[number];

export interface OutcomeSegment {
  tone: OutcomeTone;
  value: number;
}

export function OutcomeBar({
  segments,
  label,
}: {
  segments: ReadonlyArray<OutcomeSegment>;
  label: string;
}) {
  return (
    <span role="img" aria-label={label} title={label} {...stylex.props(styles.track)}>
      {segments.map((segment) =>
        segment.value === 0 ? null : (
          <span
            key={segment.tone}
            style={{ flexGrow: segment.value }}
            {...stylex.props(styles.trackSegment, fill[segment.tone])}
          />
        ),
      )}
    </span>
  );
}

export function FailureBar({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden="true" {...stylex.props(styles.track)}>
      <span
        style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }}
        {...stylex.props(styles.failureFill, fill.failed)}
      />
    </span>
  );
}

export function OutcomeSwatch({ tone }: { tone: OutcomeTone }) {
  return <i aria-hidden {...stylex.props(styles.swatch, fill[tone])} />;
}

export interface StackedBar {
  key: string;
  title: string;
  segments: ReadonlyArray<OutcomeSegment>;
}

export interface StackedBarChartProps {
  label: string;
  detailsId: string;
  ticks: ReadonlyArray<number>;
  top: number;
  bars: ReadonlyArray<StackedBar>;
  barLabels: ReadonlyArray<ReactNode>;
  minorBarLabels?: ReadonlyArray<boolean>;
}

export function StackedBarChart({
  label,
  detailsId,
  ticks,
  top,
  bars,
  barLabels,
  minorBarLabels = [],
}: StackedBarChartProps) {
  const columns = `repeat(${bars.length}, minmax(0, 1fr))`;
  return (
    <div role="img" aria-label={label} aria-details={detailsId} {...stylex.props(styles.chart)}>
      <div {...stylex.props(styles.axis)}>
        {ticks.map((tick) => (
          <span
            key={tick}
            style={{ bottom: `${(tick / top) * 100}%` }}
            {...stylex.props(textStyles("label"), styles.numeric, styles.tick)}
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
          {bars.map((bar) => (
            <div key={bar.key} title={bar.title} {...stylex.props(styles.bar)}>
              {bar.segments.map((segment) =>
                segment.value === 0 ? null : (
                  <span
                    key={segment.tone}
                    style={{ height: `calc(${(segment.value / top) * 100}% - 1px)` }}
                    {...stylex.props(styles.barSegment, fill[segment.tone])}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ gridTemplateColumns: columns }} {...stylex.props(styles.days)}>
        {barLabels.map((barLabel, i) => (
          <span
            key={i}
            {...stylex.props(
              textStyles("label"),
              styles.numeric,
              styles.day,
              minorBarLabels[i] === true && styles.minorDay,
            )}
          >
            {barLabel}
          </span>
        ))}
      </div>
    </div>
  );
}

const PLOT_HEIGHT = 128;

const styles = stylex.create({
  track: {
    display: "flex",
    gap: space.px2,
    width: "100%",
    height: space.s2,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.bgInset,
  },
  trackSegment: { minWidth: space.px2, height: "100%" },
  failureFill: { height: "100%" },
  swatch: { display: "inline-block", width: space.s2, height: space.s2, borderRadius: 2 },
  chart: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gridTemplateRows: `${PLOT_HEIGHT}px auto`,
    columnGap: space.px6,
    rowGap: space.px6,
    paddingTop: space.s2,
    containerType: "inline-size",
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
  barSegment: {
    display: "block",
    width: "56%",
    minHeight: 2,
    marginTop: 1,
    borderRadius: 1,
    flexShrink: 0,
  },
  days: { gridColumn: 2, display: "grid" },
  day: { display: "flex", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" },
  minorDay: { visibility: { default: "visible", [breakpoints.chartLabelsSparse]: "hidden" } },
  numeric: { fontVariantNumeric: "tabular-nums" },
});

const hatch = `repeating-linear-gradient(135deg, transparent 0 2px, ${colors.bgCanvas} 2px 3px)`;

const fill = stylex.create({
  succeeded: { backgroundColor: colors.merged },
  failed: { backgroundColor: colors.problem },
  canceled: { backgroundColor: colors.idle, backgroundImage: hatch },
});
