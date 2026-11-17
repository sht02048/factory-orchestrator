import * as stylex from "@stylexjs/stylex";
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, space } from "../tokens.stylex";

/*
 * 밑줄 탭. 목록 위 필터(전체·손댈 일·실행 중 …)와 화면 안 보기 전환에 쓴다.
 *
 * <Tabs value={f} onValueChange={setF} label="상태로 거르기">
 *   <Tab value="all" count={42}>전체</Tab>
 *   <Tab value="todo" count={3} attention>손댈 일</Tab>
 * </Tabs>
 * <TabPanel value="all">…</TabPanel>  // Tabs 의 panels 로 넘긴다
 */

export interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  /** 탭 목록의 접근 가능한 이름. */
  label: string;
  /** Tab 들. */
  children: ReactNode;
  /** TabPanel 들. 목록 아래에 놓인다. */
  panels?: ReactNode;
}

export function Tabs<T extends string>({
  value,
  onValueChange,
  label,
  children,
  panels,
}: TabsProps<T>) {
  return (
    <SdkTabs<T>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <TabsList aria-label={label} className={cx(styles.list)}>
        {children}
      </TabsList>
      {panels}
    </SdkTabs>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  /** 탭 옆 개수. */
  count?: number;
  /** 손댈 일이 있는 탭. 개수를 밝고 굵게 보인다(색은 쓰지 않는다). */
  attention?: boolean;
}

export function Tab({ value, children, count, attention }: TabProps) {
  return (
    <TabsTab value={value} className={(s) => cx(styles.tab, s.selected && styles.selected)}>
      {children}
      {count === undefined ? null : (
        <span {...stylex.props(styles.count, attention === true && count > 0 && styles.attention)}>
          {count}
        </span>
      )}
    </TabsTab>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPanel value={value} className={cx(styles.panel)}>
      {children}
    </TabsPanel>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    gap: space.s6,
    marginBottom: space.s2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  tab: {
    position: "relative",
    display: "flex",
    alignItems: "baseline",
    gap: space.px6,
    height: 36,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    font: "inherit",
    fontSize: fontSize.body,
    lineHeight: "36px",
    cursor: "pointer",
    transitionProperty: "color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  selected: {
    color: { default: colors.textPrimary, ":hover": colors.textPrimary },
    boxShadow: "inset 0 -2px 0 currentColor",
  },
  count: {
    fontSize: fontSize.ui,
    fontVariantNumeric: "tabular-nums",
  },
  attention: {
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  panel: { outline: "none" },
});
