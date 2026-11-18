import * as stylex from "@stylexjs/stylex";
import { Tabs as SdkTabs, TabsList, TabsTab } from "@ui-sdk/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, radius, space } from "../tokens.stylex";

export interface SegmentedTabsItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface SegmentedTabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  items: ReadonlyArray<SegmentedTabsItem<T>>;
  panels?: ReactNode;
}

export function SegmentedTabs<T extends string>({
  value,
  onValueChange,
  label,
  items,
  panels,
}: SegmentedTabsProps<T>) {
  return (
    <SdkTabs<T>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <TabsList aria-label={label} className={cx(styles.list)}>
        {items.map((item) => (
          <TabsTab
            key={item.value}
            value={item.value}
            className={(s) => cx(styles.segment, s.selected && styles.selected)}
          >
            {item.label}
            {item.count === undefined ? null : (
              <span {...stylex.props(styles.count)}>{item.count}</span>
            )}
          </TabsTab>
        ))}
      </TabsList>
      {panels}
    </SdkTabs>
  );
}

const styles = stylex.create({
  list: {
    display: "inline-flex",
    maxWidth: "100%",
    overflowX: "auto",
    scrollbarWidth: "none",
    gap: space.px2,
    padding: space.px2,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
  },
  segment: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: space.px6,
    height: 28,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    font: "inherit",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "color, background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  selected: {
    backgroundColor: { default: colors.bgRaised, ":hover": colors.bgRaised },
    color: { default: colors.textPrimary, ":hover": colors.textPrimary },
  },
  count: {
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
  },
});
