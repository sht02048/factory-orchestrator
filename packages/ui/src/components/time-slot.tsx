import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { textStyles } from "./text";
import { size } from "../tokens.stylex";

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
    inlineSize: size.timeColumn,
    overflow: "hidden",
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  action: {
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "flex-end",
    alignItems: "center",
    inlineSize: size.rowActionColumn,
  },
});
