import * as stylex from "@stylexjs/stylex";
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, radius, space } from "../tokens.stylex";

export type TabsVariant = "underline" | "chips";

const VariantContext = createContext<TabsVariant>("underline");

export interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  children: ReactNode;
  panels?: ReactNode;
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
  count?: number;
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
    boxShadow: `inset 0 -2px 0 ${colors.accent}`,
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
