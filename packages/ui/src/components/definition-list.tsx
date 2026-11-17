import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, space } from "../tokens.stylex";

/** 정의 목록: 흐린 라벨과 밝은 값의 두 열. 상세 패널의 속성(러너, 에이전트, 경과 시간 …)에 쓴다. */
export function DefinitionList({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.list)}>{children}</dl>;
}

export interface DefinitionItemProps {
  label: ReactNode;
  children: ReactNode;
  /** 값이 없을 때(없음, 아직 없음). 값을 흐리게 보인다. */
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
