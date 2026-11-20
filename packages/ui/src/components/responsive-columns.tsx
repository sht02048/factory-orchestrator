import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { breakpoints, colors, fontSize, size, space } from "../tokens.stylex";

export interface ResponsiveColumn {
  width: string;
  content: ReactNode;
}

export interface ResponsiveColumnsProps {
  id?: string;
  lead: ReactNode;
  columns: ReadonlyArray<ResponsiveColumn>;
}

export function responsiveColumnTemplates(widths: ReadonlyArray<string>): {
  wide: string;
  split: string;
} {
  const fixed = widths.slice(0, -1);
  return {
    wide: ["minmax(0, 1fr)", ...widths].join(" "),
    split: [...fixed, "minmax(0, 1fr)"].join(" "),
  };
}

export function ResponsiveColumns({ id, lead, columns }: ResponsiveColumnsProps) {
  const templates = responsiveColumnTemplates(columns.map((column) => column.width));
  return (
    <span {...stylex.props(styles.container)}>
      <span
        {...(id === undefined ? {} : { id })}
        data-columns="responsive"
        {...stylex.props(styles.grid, dynamic.columns(templates.wide, templates.split))}
      >
        <span {...stylex.props(styles.lead)}>{lead}</span>
        {columns.map((column, index) => (
          <span key={index} {...stylex.props(styles.cell)}>
            {column.content}
          </span>
        ))}
      </span>
    </span>
  );
}

export interface ResponsiveColumnsHeadProps {
  lead: ReactNode;
  columns: ReadonlyArray<ResponsiveColumn>;
}

export function ResponsiveColumnsHead({ lead, columns }: ResponsiveColumnsHeadProps) {
  const templates = responsiveColumnTemplates(columns.map((column) => column.width));
  return (
    <div aria-hidden="true" {...stylex.props(styles.container, styles.headFrame)}>
      <span
        data-columns="head"
        {...stylex.props(
          styles.grid,
          dynamic.columns(templates.wide, templates.split),
          styles.head,
        )}
      >
        <span>{lead}</span>
        {columns.map((column, index) => (
          <span key={index}>{column.content}</span>
        ))}
      </span>
    </div>
  );
}

const styles = stylex.create({
  container: { display: "block", containerType: "inline-size", minWidth: 0 },
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s5,
    rowGap: space.s2,
    minWidth: 0,
  },
  headFrame: { paddingInline: space.s3 },
  head: {
    display: { default: "grid", [breakpoints.responsiveColumnsStacked]: "none" },
    height: size.tableHeadHeight,
    marginBottom: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
  },
  lead: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: 0,
    gridColumn: { default: "auto", [breakpoints.responsiveColumnsStacked]: "1 / -1" },
  },
  cell: { display: "grid", justifyItems: "start", minWidth: 0 },
});

const dynamic = stylex.create({
  columns: (wide: string, split: string) => ({
    gridTemplateColumns: {
      default: wide,
      [breakpoints.responsiveColumnsSplit]: split,
      [breakpoints.responsiveColumnsSingle]: "minmax(0, 1fr)",
    },
  }),
});
