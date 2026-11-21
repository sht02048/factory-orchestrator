import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { statusDotStyles } from "./status-dot";
import type { PillStatus } from "./status-pill";
import { textStyles } from "./text";
import { colors, radius, size, space } from "../tokens.stylex";

export type BlockerChipState = "waiting" | "active" | "done" | "canceled";

const DOT_STATUS: Record<BlockerChipState, PillStatus> = {
  waiting: "queued",
  active: "running",
  done: "succeeded",
  canceled: "failed",
};

export function blockerDotStyles(state: BlockerChipState) {
  return [statusDotStyles(DOT_STATUS[state]), state === "done" && styles.dotDone] as const;
}

export interface BlockerChipProps {
  state: BlockerChipState;
  ticketKey: string;
  stateName: string;
}

export function BlockerChip({ state, ticketKey, stateName }: BlockerChipProps) {
  const canceled = state === "canceled";
  return (
    <span
      data-blocker-state={state}
      {...stylex.props(
        textStyles("meta"),
        styles.chip,
        state === "done" && styles.chipDone,
        canceled && styles.chipCanceled,
      )}
    >
      <span aria-hidden="true" {...stylex.props(blockerDotStyles(state))} />
      <span {...stylex.props(styles.key, state === "done" && styles.keyDone)}>{ticketKey}</span>
      <span {...stylex.props(!canceled && styles.screenReaderOnly)}>{stateName}</span>
    </span>
  );
}

export function BlockerChips({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.chips)}>{children}</span>;
}

const styles = stylex.create({
  chips: { display: "flex", flexWrap: "wrap", gap: space.px6, minWidth: 0 },
  chip: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    maxWidth: "100%",
    minHeight: size.pill,
    paddingInline: space.px6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgControl,
    color: colors.textSecondary,
    whiteSpace: "nowrap",
  },
  chipDone: { color: colors.textTertiary },
  chipCanceled: { backgroundColor: colors.problemSoft, color: colors.problem },
  dotDone: { opacity: 0.5 },
  key: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontVariantNumeric: "tabular-nums",
  },
  keyDone: { textDecorationLine: "line-through" },
  screenReaderOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});
