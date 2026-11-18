import * as stylex from "@stylexjs/stylex";
import type { ReactNode, Ref } from "react";
import { focusStyles } from "./focus";
import { colors, fonts, fontSize, fontWeight, letterSpacing, lineHeight } from "../tokens.stylex";

export const TEXT_VARIANTS = [
  "display",
  "page",
  "heading",
  "panel",
  "subheading",
  "title",
  "body",
  "ui",
  "meta",
  "label",
] as const;

export type TextVariant = (typeof TEXT_VARIANTS)[number];

type TextElement = "h1" | "h2" | "h3" | "p" | "span" | "div";

const defaultElement: Record<TextVariant, TextElement> = {
  display: "h2",
  page: "h1",
  heading: "h2",
  panel: "h2",
  subheading: "h3",
  title: "span",
  body: "p",
  ui: "span",
  meta: "span",
  label: "span",
};

export const TEXT_TONES = ["strong", "muted", "disabled", "problem"] as const;

export type TextTone = (typeof TEXT_TONES)[number];

export interface TextProps {
  variant: TextVariant;
  as?: TextElement;
  tone?: TextTone;
  numeric?: boolean;
  mono?: boolean;
  truncate?: boolean;
  wrap?: "anywhere" | "pre";
  id?: string;
  role?: "status" | "alert";
  tabIndex?: -1;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}

export function Text({
  variant,
  as,
  tone,
  numeric,
  mono,
  truncate,
  wrap,
  ref,
  children,
  ...attributes
}: TextProps) {
  const Element = as ?? defaultElement[variant];
  return (
    <Element
      {...attributes}
      ref={ref === undefined ? undefined : (node: HTMLElement | null) => assignRef(ref, node)}
      {...stylex.props(
        textStyles(variant, tone),
        numeric === true && styles.numeric,
        mono === true && styles.mono,
        truncate === true && styles.truncate,
        wrap === "anywhere" && styles.anywhere,
        wrap === "pre" && styles.preWrap,
        attributes.tabIndex === -1 && focusStyles.ring,
      )}
    >
      {children}
    </Element>
  );
}

function assignRef(ref: Ref<HTMLElement>, node: HTMLElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref !== null) ref.current = node;
}

export function textStyles(role: TextVariant, tone?: TextTone) {
  return [styles.reset, roles[role], tone === undefined ? null : tones[tone]] as const;
}

const tones = stylex.create({
  strong: { color: colors.textPrimary },
  muted: { color: colors.textTertiary },
  disabled: { color: colors.textDisabled },
  problem: { color: colors.problem },
});

const roles = stylex.create({
  display: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.display,
    textWrap: "balance",
  },
  page: {
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.page,
    textWrap: "balance",
  },
  heading: {
    color: colors.textPrimary,
    fontSize: fontSize.heading,
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
  subheading: {
    color: colors.textPrimary,
    fontSize: fontSize.subheading,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.panel,
    textWrap: "pretty",
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
});

const styles = stylex.create({
  reset: { margin: 0 },
  numeric: { fontVariantNumeric: "tabular-nums" },
  mono: { fontFamily: fonts.mono, fontSize: "0.92em" },
  anywhere: { overflowWrap: "anywhere" },
  preWrap: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  truncate: {
    display: "block",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});
