import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, space } from "../tokens.stylex";

export function DefinitionList({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.list)}>{children}</dl>;
}

export interface DefinitionItemProps {
  label: ReactNode;
  children: ReactNode;
  empty?: boolean;
}

export function DefinitionItem({ label, children, empty }: DefinitionItemProps) {
  return (
    <>
      <dt {...stylex.props(styles.term)}>{label}</dt>
      <dd {...stylex.props(styles.value, empty === true && styles.empty)}>{children}</dd>
    </>
  );
}

const styles = stylex.create({
  list: {
    display: "grid",
    gridTemplateColumns: "96px minmax(0, 1fr)",
    rowGap: space.s2,
    columnGap: space.s4,
    margin: 0,
  },
  term: { color: colors.textTertiary },
  value: {
    minWidth: 0,
    margin: 0,
    overflowWrap: "anywhere",
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
  },
  empty: { color: colors.textTertiary },
});
