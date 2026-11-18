import * as stylex from "@stylexjs/stylex";
import type { ReactNode, Ref } from "react";
import { focusStyles } from "./focus";
import { colors, fonts, fontSize, lineHeight, radius, size, space } from "../tokens.stylex";

export interface CodeBlockProps {
  children: ReactNode;
  scroll?: boolean;
  tone?: "output" | "command";
  label?: string;
  ref?: Ref<HTMLPreElement>;
}

export function CodeBlock({ children, scroll, tone = "output", label, ref }: CodeBlockProps) {
  const scrolling = scroll === true;
  return (
    <pre
      {...(ref === undefined ? {} : { ref })}
      {...(scrolling ? { tabIndex: 0 } : {})}
      {...(label === undefined ? {} : { role: "region", "aria-label": label })}
      {...stylex.props(
        styles.block,
        tone === "command" && styles.command,
        scrolling && styles.scroll,
        scrolling && focusStyles.ring,
      )}
    >
      {children}
    </pre>
  );
}

const styles = stylex.create({
  block: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: fontSize.small,
    lineHeight: lineHeight.relaxed,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  command: {
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderDefault,
    color: colors.textPrimary,
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  scroll: { maxHeight: size.logMaxHeight, overflowY: "auto" },
});
