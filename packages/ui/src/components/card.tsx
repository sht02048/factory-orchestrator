import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, radius, space } from "../tokens.stylex";

export interface CardProps {
  children: ReactNode;
  padding?: "normal" | "compact";
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
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  href?: string;
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
