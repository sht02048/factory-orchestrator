import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, radius, space } from "../tokens.stylex";

/*
 * 카드와 행(ADR 0010 10번). 영역은 선이 아니라 면(배경색)으로 나눈다.
 * - Card: 손댈 일 카드, 러너 카드, Run 상세의 정보·타임라인 묶음. 둥글기 12.
 * - Row: 카드 안 한 줄(타임라인, 흐름). 둥글기 8. 앞에 아이콘·알약, 뒤에 시간 같은 흐린 값.
 *   href 를 주면 행 전체가 링크다. 누를 수 없는 행은 interactive={false} 로 hover 면을 끈다.
 */

export interface CardProps {
  children: ReactNode;
  /** 안쪽 여백. 행을 담는 카드는 compact 로 두어 행의 hover 면이 카드 가장자리에 붙지 않게 한다. */
  padding?: "normal" | "compact";
  /** 카드를 구역으로 읽게 할 때 이름. 주면 section 으로 그린다. */
  label?: string;
}

export function Card({ children, padding = "normal", label }: CardProps) {
  const props = stylex.props(styles.card, padding === "compact" && styles.compact);
  return label === undefined ? (
    <div {...props}>{children}</div>
  ) : (
    <section aria-label={label} {...props}>
      {children}
    </section>
  );
}

export interface RowProps {
  /** 앞쪽 아이콘이나 상태 알약 */
  leading?: ReactNode;
  children: ReactNode;
  /** 뒤쪽 흐린 값(시간 등) */
  trailing?: ReactNode;
  /** 주면 행 전체를 이 주소로 가는 링크로 그린다. */
  href?: string;
  /**
   * 행이 눌리는지. false 면 hover 면을 칠하지 않는다. 누를 수 없는 행에 hover 면이 생기면
   * 누를 수 있는 것처럼 보인다. 기본은 true(행 안에 링크를 둔 화면).
   */
  interactive?: boolean;
}

export function Row({ leading, children, trailing, href, interactive = true }: RowProps) {
  const content = (
    <>
      {leading === undefined ? null : <span {...stylex.props(styles.leading)}>{leading}</span>}
      <div {...stylex.props(styles.body)}>{children}</div>
      {trailing === undefined ? null : <span {...stylex.props(styles.trailing)}>{trailing}</span>}
    </>
  );
  if (href !== undefined) {
    return (
      <a href={href} {...stylex.props(styles.row, styles.hover, styles.link)}>
        {content}
      </a>
    );
  }
  return <div {...stylex.props(styles.row, interactive && styles.hover)}>{content}</div>;
}

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  compact: { gap: 0, padding: space.s2 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: "transparent",
  },
  // hover 면은 hover 가 되는 기기에서만 칠한다. 터치 뒤 hover 면이 남지 않게 한다.
  hover: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  link: {
    color: "inherit",
    textDecoration: "none",
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  leading: { display: "inline-flex", flexShrink: 0, alignItems: "center" },
  body: { flexGrow: 1, minWidth: 0 },
  trailing: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
  },
});
