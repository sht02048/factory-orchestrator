import * as stylex from "@stylexjs/stylex";
import {
  Menu as SdkMenu,
  MenuContent,
  MenuItem as SdkMenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as SdkMenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontWeight, motion, radius, space } from "../tokens.stylex";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { popupStyles } from "./popup-styles";

export interface MenuProps {
  trigger: ReactNode;
  label?: string;
  variant?: "default" | "rail";
  children: ReactNode;
}

export function Menu({ trigger, label, variant = "default", children }: MenuProps) {
  const rail = variant === "rail";
  return (
    <SdkMenu>
      <MenuTrigger
        {...(label === undefined ? {} : { "aria-label": label })}
        className={(s) =>
          cx(styles.trigger, rail && styles.railTrigger, s.open && styles.triggerOpen)
        }
      >
        {rail ? (
          trigger
        ) : (
          <>
            <span {...stylex.props(styles.triggerText)}>{trigger}</span>
            <span {...stylex.props(styles.chevron)}>
              <ChevronDownIcon />
            </span>
          </>
        )}
      </MenuTrigger>
      <MenuContent
        side={rail ? "right" : "bottom"}
        align="start"
        sideOffset={rail ? 8 : 4}
        className={cx(popupStyles.content)}
      >
        {children}
      </MenuContent>
    </SdkMenu>
  );
}

export interface MenuItemProps {
  value: string;
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export function MenuItem({ value, children, onSelect, disabled }: MenuItemProps) {
  return (
    <SdkMenuItem
      value={value}
      {...(onSelect === undefined ? {} : { onSelect })}
      {...(disabled === undefined ? {} : { disabled })}
      className={(s) =>
        cx(
          popupStyles.item,
          s.highlighted && popupStyles.highlighted,
          s.disabled && popupStyles.disabled,
        )
      }
    >
      {children}
    </SdkMenuItem>
  );
}

export interface MenuRadioProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}

export function MenuRadio<T extends string>({ value, onValueChange, children }: MenuRadioProps<T>) {
  return (
    <MenuRadioGroup<T>
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
      }}
      className={cx(styles.group)}
    >
      {children}
    </MenuRadioGroup>
  );
}

export function MenuRadioOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <MenuRadioItem
      value={value}
      closeOnSelect
      className={(s) =>
        cx(
          popupStyles.item,
          s.highlighted && popupStyles.highlighted,
          s.checked && popupStyles.selected,
        )
      }
    >
      {children}
      <MenuItemIndicator className={cx(popupStyles.indicator)}>
        <CheckIcon />
      </MenuItemIndicator>
    </MenuRadioItem>
  );
}

export function MenuSeparator() {
  return <SdkMenuSeparator className={cx(styles.separator)} />;
}

const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "100%",
    height: 34,
    paddingInline: space.s2,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    boxShadow: `inset 0 0 0 1px ${colors.borderSubtle}`,
    color: colors.textPrimary,
    font: "inherit",
    fontWeight: fontWeight.medium,
    textAlign: "start",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  railTrigger: {
    flexDirection: "column",
    justifyContent: "center",
    gap: space.s1,
    height: "auto",
    paddingBlock: space.s2,
    paddingInline: space.s1,
    boxShadow: "none",
    textAlign: "center",
  },
  triggerOpen: { backgroundColor: colors.bgHover },
  triggerText: {
    display: "flex",
    gap: space.px6,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  chevron: {
    display: "inline-flex",
    flexShrink: 0,
    marginInlineStart: "auto",
    color: colors.textTertiary,
  },
  group: { display: "flex", flexDirection: "column", gap: space.px2 },
  separator: {
    height: 1,
    marginBlock: space.px2,
    backgroundColor: colors.borderSubtle,
  },
});
