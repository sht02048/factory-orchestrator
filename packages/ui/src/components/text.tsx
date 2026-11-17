import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fonts, fontSize, fontWeight, letterSpacing, lineHeight } from "../tokens.stylex";

/**
 * 글자 위계. 시안 B 의 세 단계를 따른다.
 *
 * 1단계(화면을 대표): page(페이지 제목), panel(상세 패널 제목)
 * 2단계(읽는 내용): section(구역 제목), title(행 제목), body(설명 문단)
 * 3단계(흐린 보조): ui(일반 UI 글), meta(ID·러너·시간처럼 흐린 값), label(작은 머리글)
 */
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
  /** 기본 요소를 바꿀 때만 쓴다(문서 구조상 h2 대신 h3 등). */
  as?: TextElement;
  /** 숫자를 세로로 맞춘다(tabular-nums). 시간·개수·ID 에 쓴다. */
  numeric?: boolean;
  /** 고정폭 글꼴. 경로·명령·키처럼 그대로 옮겨 쓸 값에 쓴다. */
  mono?: boolean;
  /** 한 줄로 자르고 말줄임표를 붙인다. */
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
