import * as stylex from "@stylexjs/stylex";
import { colors, radius } from "../tokens.stylex";

export const focusStyles = stylex.create({
  ring: {
    borderRadius: radius.control,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  ringInset: {
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  target: { outline: "none" },
});
