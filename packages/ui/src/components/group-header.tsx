import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, radius, size, space } from "../tokens.stylex";
import { statusTone, type PillStatus } from "./status-pill";
import { textStyles } from "./text";

export interface GroupHeaderProps {
  status: PillStatus;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
}

export function GroupHeader({
  status,
  title,
  count,
  description,
  headingLevel = "h3",
}: GroupHeaderProps) {
  const Heading = headingLevel;
  const tone = statusTone(status);
  return (
    <div data-status={status} data-tone={tone} {...stylex.props(styles.header)}>
      <span aria-hidden="true" {...stylex.props(styles.dot, dotTone[tone])} />
      <Heading {...stylex.props(textStyles("section"), styles.title)}>
        {title}
        {count === undefined ? null : <span {...stylex.props(styles.count)}> {count}</span>}
      </Heading>
      {description === undefined ? null : (
        <span {...stylex.props(styles.description)}>{description}</span>
      )}
    </div>
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s1,
  },
  dot: {
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
  },
  title: { display: "inline-flex", alignItems: "baseline", gap: space.px6, minWidth: 0 },
  count: {
    color: colors.textTertiary,
    fontWeight: "inherit",
    fontVariantNumeric: "tabular-nums",
  },
  description: {
    marginInlineStart: "auto",
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});

const dotTone = stylex.create({
  answer: { backgroundColor: colors.answer },
  check: { backgroundColor: colors.check },
  problem: { backgroundColor: colors.problem },
  progress: { backgroundColor: colors.progress },
  merged: { backgroundColor: colors.merged },
  idle: { backgroundColor: colors.idle },
});
