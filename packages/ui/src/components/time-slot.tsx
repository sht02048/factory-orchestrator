import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { textStyles } from "./text";
import { breakpoints, size } from "../tokens.stylex";

export interface TimeSlotProps {
  children: ReactNode;
  dateTime?: string;
}

export function TimeSlot({ children, dateTime }: TimeSlotProps) {
  const props = stylex.props(textStyles("meta"), styles.time);
  return dateTime === undefined ? (
    <span data-slot="time" {...props}>
      {children}
    </span>
  ) : (
    <time dateTime={dateTime} data-slot="time" {...props}>
      {children}
    </time>
  );
}

export function RowActionSlot({ children }: { children?: ReactNode }) {
  return (
    <span data-slot="action" {...stylex.props(styles.action)}>
      {children}
    </span>
  );
}

const styles = stylex.create({
  time: {
    display: "inline-block",
    flexShrink: 0,
    minInlineSize: { default: size.timeColumn, [breakpoints.rowSlotsFit]: 0 },
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  action: {
    display: "inline-flex",
    flexShrink: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    minInlineSize: { default: size.rowActionColumn, [breakpoints.rowSlotsFit]: 0 },
    maxInlineSize: "100%",
  },
});
