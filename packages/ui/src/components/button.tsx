import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode } from "react";
import { cx, type StyleArg } from "../cx";
import { colors, fontWeight, motion, radius, size, space } from "../tokens.stylex";

/**
 * 버튼 위계(ADR 0010 6번).
 * - primary: 파랑. 화면 전체에서 주 행동 하나에만.
 * - secondary: 기본. 카드 행동, 질문 선택지처럼 나머지 행동.
 * - danger: 빨간 글자 보조 버튼. 취소·거절 같은 위험 행동.
 * - ghost: 바탕 없는 덜 중요한 행동(닫기, 접기).
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type SdkButtonProps = ComponentProps<typeof SdkButton>;

export interface ButtonProps {
  /** 기본은 secondary. primary 는 화면에 하나만 둔다(ADR 0010 6번). */
  variant?: ButtonVariant;
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: SdkButtonProps["onClick"];
  "aria-label"?: string;
}

export function Button({ variant = "secondary", children, onClick, ...props }: ButtonProps) {
  return (
    <SdkButton
      {...props}
      // 화면에 주 버튼이 하나 이하인지 시험이 읽는다(ADR 0010 6번)
      data-variant={variant}
      {...(onClick === undefined ? {} : { onClick })}
      className={(s) => cx(...buttonStyles(variant, s.disabled))}
    >
      {children}
    </SdkButton>
  );
}

/**
 * 버튼 모양을 다른 UI SDK 트리거(DialogTrigger 등)나 링크에 입힐 때 쓴다.
 * 링크에 입히면 `data-variant` 도 함께 붙여 주 버튼 시험이 세게 한다.
 */
export function buttonStyles(variant: ButtonVariant, disabled = false): ReadonlyArray<StyleArg> {
  return [
    styles.base,
    variant === "primary" && styles.primary,
    variant === "danger" && styles.danger,
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
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: colors.bgControl, ":hover": colors.bgControlHover },
    color: colors.textPrimary,
    font: "inherit",
    fontWeight: fontWeight.medium,
    // 버튼 모양을 입힌 링크(buttonStyles)에 밑줄이 생기지 않게 한다
    textDecoration: "none",
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
    backgroundColor: { default: colors.accent, ":hover": colors.accentHover },
    color: colors.textOnAccent,
  },
  danger: { color: colors.problem },
  ghost: {
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
  },
  disabled: {
    backgroundColor: { default: colors.bgCard, ":hover": colors.bgCard },
    color: { default: colors.textDisabled, ":hover": colors.textDisabled },
    cursor: "not-allowed",
    transform: { default: null, ":active": null },
  },
});
