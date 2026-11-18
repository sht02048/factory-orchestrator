import * as stylex from "@stylexjs/stylex";
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, radius, space } from "../tokens.stylex";

/*
 * 밑줄 탭. 목록 위 필터(전체·손댈 일·실행 중 …)와 화면 안 보기 전환에 쓴다.
 *
 * <Tabs value={f} onValueChange={setF} label="상태로 거르기">
 *   <Tab value="all" count={42}>전체</Tab>
 *   <Tab value="todo" count={3} attention>손댈 일</Tab>
 * </Tabs>
 * <TabPanel value="all">…</TabPanel>  // Tabs 의 panels 로 넘긴다
 *
 * variant="chips" 는 둥근 칩 줄이다(Runs 의 상태 칩 필터, ADR 0010). 고른 칩만 밝은 면이다.
 */

export type TabsVariant = "underline" | "chips";

const VariantContext = createContext<TabsVariant>("underline");

export interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  /** 탭 목록의 접근 가능한 이름. */
  label: string;
  /** Tab 들. */
  children: ReactNode;
  /** TabPanel 들. 목록 아래에 놓인다. */
  panels?: ReactNode;
  /** 기본은 밑줄 탭. chips 는 상태 칩 필터. */
  variant?: TabsVariant;
}

export function Tabs<T extends string>({
  value,
  onValueChange,
  label,
  children,
  panels,
  variant = "underline",
}: TabsProps<T>) {
  return (
    <SdkTabs<T>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <VariantContext value={variant}>
        <TabsList
          aria-label={label}
          className={cx(variant === "chips" ? styles.chipList : styles.list)}
        >
          {children}
        </TabsList>
      </VariantContext>
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
  const variant = use(VariantContext);
  return (
    <TabsTab
      value={value}
      className={(s) =>
        variant === "chips"
          ? cx(styles.tab, styles.chip, s.selected && styles.chipSelected)
          : cx(styles.tab, s.selected && styles.selected)
      }
    >
      {children}
      {count === undefined ? null : (
        <span
          {...stylex.props(
            styles.count,
            variant === "chips" && styles.chipCount,
            attention === true &&
              count > 0 &&
              (variant === "chips" ? styles.chipAttention : styles.attention),
          )}
        >
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
    // 영어 상태 이름(ADR 0010)이 길어 탭이 넘치면 줄바꿈 대신 가로로 스크롤한다.
    overflowX: "auto",
    scrollbarWidth: "none",
    gap: space.s5,
    marginBottom: space.s2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  tab: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
    whiteSpace: "nowrap",
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
  chipList: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.s2,
    marginBottom: space.s4,
  },
  chip: {
    alignItems: "center",
    height: 32,
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: { default: colors.bgControl, ":hover": colors.bgControlHover },
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    lineHeight: "32px",
    transitionProperty: "color, background-color",
  },
  // 칩의 개수는 칩 글자색을 따라 흐리게 둔다(고른 칩의 밝은 면 위에서도 읽힌다).
  chipCount: { opacity: 0.6 },
  chipAttention: { opacity: 1, fontWeight: fontWeight.semibold },
  chipSelected: {
    backgroundColor: { default: colors.textPrimary, ":hover": colors.textPrimary },
    color: { default: colors.bgCanvas, ":hover": colors.bgCanvas },
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
