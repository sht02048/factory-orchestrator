import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fonts, fontSize, fontWeight, letterSpacing, lineHeight } from "../tokens.stylex";

export type TextVariant = "page" | "panel" | "section" | "title" | "body" | "ui" | "meta" | "label";

type TextElement = "h1" | "h2" | "h3" | "p" | "span" | "div";

const defaultElement: Record<TextVariant, TextElement> = {
  page: "h1",
  panel: "h2",
  section: "h2",
  title: "span",
  body: "p",
  ui: "span",
  meta: "span",
  label: "span",
};

export interface TextProps {
  variant: TextVariant;
  as?: TextElement;
  numeric?: boolean;
  mono?: boolean;
  truncate?: boolean;
  children: ReactNode;
}

export function Text({ variant, as, numeric, mono, truncate, children }: TextProps) {
  const Element = as ?? defaultElement[variant];
  return (
    <Element
      {...stylex.props(
        styles.reset,
        styles[variant],
        numeric === true && styles.numeric,
        mono === true && styles.mono,
        truncate === true && styles.truncate,
      )}
    >
      {children}
    </Element>
  );
}

const styles = stylex.create({
  reset: { margin: 0 },
  page: {
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.page,
    textWrap: "balance",
  },
  panel: {
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.panel,
    textWrap: "pretty",
  },
  section: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.normal,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  ui: {
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
  },
  meta: {
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
  },
  label: {
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  numeric: { fontVariantNumeric: "tabular-nums" },
  mono: { fontFamily: fonts.mono, fontSize: "0.92em" },
  truncate: {
    display: "block",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});
