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

/*
 * 메뉴: 누르면 열리는 행동 목록. 사이드바의 Workspace 전환기처럼
 * 하나를 고르는 메뉴는 MenuRadio, 행동 목록은 MenuItem 을 쓴다.
 * 폼 안에서 값을 고르는 곳은 Select 를 쓴다.
 */

export interface MenuProps {
  /** 트리거 안 내용. 흐린 라벨과 현재 값을 함께 넣을 수 있다. */
  trigger: ReactNode;
  /** 트리거의 접근 가능한 이름(트리거 글만으로 뜻이 모자랄 때). */
  label?: string;
  children: ReactNode;
}

export function Menu({ trigger, label, children }: MenuProps) {
  return (
    <SdkMenu>
      <MenuTrigger
        {...(label === undefined ? {} : { "aria-label": label })}
        className={(s) => cx(styles.trigger, s.open && styles.triggerOpen)}
      >
        <span {...stylex.props(styles.triggerText)}>{trigger}</span>
        <span {...stylex.props(styles.chevron)}>
          <ChevronDownIcon />
        </span>
      </MenuTrigger>
      <MenuContent side="bottom" align="start" sideOffset={4} className={cx(popupStyles.content)}>
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

/** 하나를 고르는 메뉴 묶음. 고른 항목에 체크 표시가 붙는다. */
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
