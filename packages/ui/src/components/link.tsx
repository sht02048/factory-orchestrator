import * as stylex from "@stylexjs/stylex";
import type { MouseEventHandler, ReactNode } from "react";
import type { StyleArg } from "../cx";
import { colors, fontWeight, space } from "../tokens.stylex";
import { focusStyles } from "./focus";

export type LinkTone = "accent" | "quiet" | "action" | "plain";

export function linkStyles(tone: LinkTone = "accent"): ReadonlyArray<StyleArg> {
  return [styles.base, styles[tone], focusStyles.ring];
}

export interface TextLinkProps {
  href: string;
  tone?: LinkTone;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  children: ReactNode;
}

export function TextLink({ href, tone, external, onClick, children }: TextLinkProps) {
  return (
    <a
      href={href}
      {...(external === true ? { target: "_blank", rel: "noreferrer" } : {})}
      {...(onClick === undefined ? {} : { onClick })}
      {...stylex.props(linkStyles(tone))}
    >
      {children}
    </a>
  );
}

const styles = stylex.create({
  base: { textUnderlineOffset: 3 },
  accent: { color: colors.accentText },
  quiet: {
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    textDecoration: "none",
  },
  plain: {
    color: "inherit",
    textDecoration: { default: "none", ":hover": "underline", ":focus-visible": "underline" },
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    color: colors.accentText,
    fontWeight: fontWeight.medium,
    textDecoration: { default: "none", ":hover": "underline" },
  },
});
