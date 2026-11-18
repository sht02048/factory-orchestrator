import * as stylex from "@stylexjs/stylex";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/react/meter";
import { cx } from "../cx";
import { colors, fontSize, radius, space } from "../tokens.stylex";

export type CapacityTone = "progress" | "problem";

export interface CapacityBarProps {
  used: number;
  total: number;
  label: string;
  tone?: CapacityTone;
}

export function capacityText(used: number, total: number): string {
  return `${used}/${total}`;
}

export function CapacityBar({ used, total, label, tone = "progress" }: CapacityBarProps) {
  const text = capacityText(used, total);
  return (
    <Meter
      value={used}
      min={0}
      max={Math.max(total, 1)}
      aria-label={label}
      getValueLabel={() => text}
      data-tone={tone}
      className={cx(styles.root)}
    >
      <MeterTrack className={cx(styles.track)}>
        <MeterIndicator className={cx(styles.indicator, indicatorTone[tone])} />
      </MeterTrack>
      <span aria-hidden="true" {...stylex.props(styles.text)}>
        {text}
      </span>
    </Meter>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
  },
  track: {
    position: "relative",
    flexGrow: 1,
    minWidth: 48,
    height: 6,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.idleSoft,
  },
  indicator: {
    height: "100%",
    borderRadius: radius.full,
  },
  text: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
});

const indicatorTone = stylex.create({
  progress: { backgroundColor: colors.progress },
  problem: { backgroundColor: colors.problem },
});
