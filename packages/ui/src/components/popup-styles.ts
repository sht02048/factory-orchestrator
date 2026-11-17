import * as stylex from "@stylexjs/stylex";
import { colors, fontSize, motion, radius, shadow, space } from "../tokens.stylex";

// Menu·Select 처럼 떠 있는 목록이 함께 쓰는 모양.

const popIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.97) translateY(-2px)" },
  to: { opacity: 1, transform: "none" },
});

export const popupStyles = stylex.create({
  content: {
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: "var(--anchor-width, 160px)",
    maxHeight: "var(--available-height, 320px)",
    overflow: "auto",
    margin: 0,
    padding: space.s1,
    // UI SDK 팝업은 popover 요소라 브라우저 기본 테두리가 붙는다. 테두리는 그림자 토큰이 맡는다.
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    outline: "none",
    transformOrigin: "var(--transform-origin, top center)",
    animationName: {
      default: popIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: 30,
    paddingInline: space.s2,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    cursor: "pointer",
    outline: "none",
    userSelect: "none",
  },
  highlighted: {
    backgroundColor: colors.bgHover,
    color: colors.textPrimary,
  },
  selected: { color: colors.textPrimary },
  disabled: { color: colors.textDisabled, cursor: "not-allowed" },
  indicator: {
    display: "inline-flex",
    marginInlineStart: "auto",
    width: 14,
    height: 14,
  },
});
