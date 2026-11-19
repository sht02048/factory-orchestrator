import * as stylex from "@stylexjs/stylex";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/react/meter";
import { cx } from "../cx";
import { colors, fontSize, radius, space } from "../tokens.stylex";
import { usageText, type UsageTone } from "./usage-bar";

export interface UsageMeterProps {
  name: string;
  percent: number;
  label: string;
  tone?: UsageTone;
}

export function UsageMeter({ name, percent, label, tone = "neutral" }: UsageMeterProps) {
  const text = usageText(percent);
  return (
    <Meter
      value={Math.min(Math.max(percent, 0), 100)}
      min={0}
      max={100}
      aria-label={label}
      getValueLabel={() => text}
      data-tone={tone}
      className={cx(styles.root)}
    >
      <span aria-hidden="true" {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        <span {...stylex.props(styles.value, valueTone[tone])}>{text}</span>
      </span>
      <MeterTrack className={cx(styles.track)}>
        <MeterIndicator className={cx(styles.indicator, indicatorTone[tone])} />
      </MeterTrack>
    </Meter>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    minWidth: 0,
  },
  line: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s2,
    minWidth: 0,
    fontSize: fontSize.ui,
  },
  name: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  value: {
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  track: {
    position: "relative",
    height: 6,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.meterTrack,
  },
  indicator: {
    height: "100%",
    borderRadius: radius.full,
  },
});

const indicatorTone = stylex.create({
  neutral: { backgroundColor: colors.meterFill },
  problem: { backgroundColor: colors.problem },
});

const valueTone = stylex.create({
  neutral: { color: colors.textPrimary },
  problem: { color: colors.problem },
});
