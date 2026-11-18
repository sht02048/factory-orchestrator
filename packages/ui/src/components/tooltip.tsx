import * as stylex from "@stylexjs/stylex";
import { Tooltip as SdkTooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, lineHeight, motion, radius, shadow, space } from "../tokens.stylex";

/*
 * 짧은 힌트. 아이콘만 있는 버튼의 이름이나, 잘린 값의 전체를 보일 때만 쓴다.
 * 링크나 버튼처럼 누를 것은 넣지 않는다(툴팁에는 포커스가 가지 않는다).
 *
 * <Tooltip content="ssh 설정의 Host 이름">runner-a</Tooltip>
 */

export interface TooltipProps {
  /** 힌트 글. 몇 단어로 쓴다. */
  content: string;
  /** 트리거 안 내용. 글자 또는 아이콘. */
  children: ReactNode;
  /** 트리거가 아이콘뿐일 때 true. 힌트가 트리거의 이름이 된다. */
  labelsTrigger?: boolean;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, labelsTrigger, side = "top" }: TooltipProps) {
  return (
    <SdkTooltip type={labelsTrigger === true ? "label" : "description"}>
      <TooltipTrigger className={cx(styles.trigger)}>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className={cx(styles.content)}>
        {content}
      </TooltipContent>
    </SdkTooltip>
  );
}

const popIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.97)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: colors.textTertiary,
    textUnderlineOffset: 3,
    cursor: "help",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
    borderRadius: radius.pill,
  },
  content: {
    zIndex: 100,
    maxWidth: 260,
    margin: 0,
    borderWidth: 0,
    paddingBlock: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    fontSize: fontSize.small,
    lineHeight: lineHeight.snug,
    transformOrigin: "var(--transform-origin)",
    animationName: {
      default: popIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
});
