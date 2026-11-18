import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, size, space } from "../tokens.stylex";

export function DividedList({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.list)}>{children}</ul>;
}

export function DividedItem({ tight, children }: { tight?: boolean; children: ReactNode }) {
  return <li {...stylex.props(styles.item, tight === true && styles.tight)}>{children}</li>;
}

const styles = stylex.create({
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    maxWidth: size.formWidth,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingBlock: space.s4,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  tight: { gap: space.s1, paddingBlock: space.s2 },
});
