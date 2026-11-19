import * as stylex from "@stylexjs/stylex";
import { capacityText, type CapacityTone } from "./capacity-bar";
import { colors, fontSize, space } from "../tokens.stylex";

export const CAPACITY_CELLS_MAX = 8;

export interface CapacityCellsProps {
  used: number;
  total: number;
  label: string;
  tone?: CapacityTone;
}

export function showsCapacityCells(total: number): boolean {
  return total > 0 && total <= CAPACITY_CELLS_MAX;
}

export function CapacityCells({ used, total, label, tone = "progress" }: CapacityCellsProps) {
  const filled = Math.min(Math.max(used, 0), total);
  const cells = showsCapacityCells(total);
  return (
    <span
      role="img"
      aria-label={label}
      data-tone={tone}
      data-cells={cells ? "shown" : "number-only"}
      {...stylex.props(styles.root)}
    >
      {cells ? (
        <span aria-hidden="true" {...stylex.props(styles.cells)}>
          {Array.from({ length: total }, (_, index) => {
            const isUsed = index < filled;
            return (
              <span
                key={index}
                data-cell={isUsed ? "used" : "free"}
                {...stylex.props(styles.cell, isUsed ? usedTone[tone] : styles.free)}
              />
            );
          })}
        </span>
      ) : null}
      <span aria-hidden="true" {...stylex.props(styles.text)}>
        {capacityText(used, total)}
      </span>
    </span>
  );
}

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s2,
    minWidth: 0,
  },
  cells: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px2,
    flexShrink: 0,
  },
  cell: {
    boxSizing: "border-box",
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
    borderStyle: "solid",
  },
  free: {
    borderColor: colors.borderStrong,
    backgroundColor: "transparent",
  },
  text: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
});

const usedTone = stylex.create({
  progress: { borderColor: colors.progress, backgroundColor: colors.progress },
  problem: { borderColor: colors.problem, backgroundColor: colors.problem },
});
