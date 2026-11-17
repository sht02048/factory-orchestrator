import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode } from "react";
import { cx, type StyleArg } from "../cx";
import { colors, fontWeight, motion, radius, size, space } from "../tokens.stylex";

export type ButtonVariant = "default" | "primary" | "ghost";

type SdkButtonProps = ComponentProps<typeof SdkButton>;

export interface ButtonProps {
  /** default: 보조 행동. primary: 화면에서 가장 먼저 할 행동 하나. ghost: 덜 중요한 행동. */
  variant?: ButtonVariant;
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: SdkButtonProps["onClick"];
  "aria-label"?: string;
}

export function Button({ variant = "default", children, onClick, ...props }: ButtonProps) {
  return (
    <SdkButton
      {...props}
      {...(onClick === undefined ? {} : { onClick })}
      className={(s) => cx(...buttonStyles(variant, s.disabled))}
    >
      {children}
    </SdkButton>
  );
}

/** 버튼 모양을 다른 UI SDK 트리거(DialogTrigger 등)에 입힐 때 쓴다. */
export function buttonStyles(variant: ButtonVariant, disabled = false): ReadonlyArray<StyleArg> {
  return [
    styles.base,
    variant === "primary" && styles.primary,
    variant === "ghost" && styles.ghost,
    disabled && styles.disabled,
  ];
}

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.px6,
    height: size.control,
    paddingBlock: 0,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.borderDefault, ":hover": colors.borderStrong },
    borderRadius: radius.md,
    backgroundColor: { default: colors.bgRaised, ":hover": colors.bgRaisedHover },
    color: colors.textPrimary,
    font: "inherit",
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    transform: { default: null, ":active": "scale(0.97)" },
    transitionProperty: "background-color, border-color, color, transform",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  primary: {
    borderColor: { default: "transparent", ":hover": "transparent" },
    backgroundColor: { default: colors.accent, ":hover": colors.accentHover },
    color: colors.textOnAccent,
  },
  ghost: {
    borderColor: { default: "transparent", ":hover": "transparent" },
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
  },
  disabled: {
    borderColor: { default: colors.borderSubtle, ":hover": colors.borderSubtle },
    backgroundColor: { default: "transparent", ":hover": "transparent" },
    color: { default: colors.textDisabled, ":hover": colors.textDisabled },
    cursor: "not-allowed",
    transform: { default: null, ":active": null },
  },
});
