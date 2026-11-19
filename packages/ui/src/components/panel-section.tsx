import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { colors, fontSize, fontWeight, space } from "../tokens.stylex";

export interface PanelSectionProps {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}

export function PanelSection({ title, meta, children }: PanelSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.head)}>
        <h3 id={titleId} {...stylex.props(styles.title)}>
          {title}
        </h3>
        {meta === undefined ? null : <span {...stylex.props(styles.meta)}>{meta}</span>}
      </div>
      {children}
    </section>
  );
}

const styles = stylex.create({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
  },
  head: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
  },
  title: {
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
});
