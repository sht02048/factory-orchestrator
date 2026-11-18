import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { colors, fontSize, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";
import { textStyles } from "./text";

export type StatTrend = "better" | "worse";

export interface StatTileProps {
  value: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  trend?: StatTrend;
}

export function StatTile({ value, label, detail, trend }: StatTileProps) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      {...stylex.props(surfaceStyles("card"), styles.tile)}
    >
      <span id={labelId} {...stylex.props(textStyles("label"))}>
        {label}
      </span>
      <span {...stylex.props(textStyles("display"), styles.value)}>{value}</span>
      {detail === undefined ? null : (
        <span
          data-trend={trend ?? "none"}
          {...stylex.props(styles.detail, trend === undefined ? null : trendTone[trend])}
        >
          {detail}
        </span>
      )}
    </div>
  );
}

const styles = stylex.create({
  tile: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  value: { fontVariantNumeric: "tabular-nums" },
  detail: {
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
});

const trendTone = stylex.create({
  better: { color: colors.progress },
  worse: { color: colors.problem },
});
