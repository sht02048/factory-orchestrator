import * as stylex from "@stylexjs/stylex";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
import {
  breakpoints,
  colors,
  fontSize,
  fontWeight,
  motion,
  radius,
  size,
  space,
} from "../tokens.stylex";

const gridColumns = stylex.create({
  of: (wide: string, narrow: string) => ({
    gridTemplateColumns: { default: wide, [breakpoints.tableStacked]: narrow },
  }),
});

const ColumnsContext = createContext(gridColumns.of("minmax(0, 1fr)", "minmax(0, 1fr)"));

export interface TableProps {
  columns: string;
  narrowColumns?: string;
  children: ReactNode;
}

export function Table({ columns, narrowColumns, children }: TableProps) {
  return (
    <ColumnsContext value={gridColumns.of(columns, narrowColumns ?? columns)}>
      <div {...stylex.props(styles.table)}>{children}</div>
    </ColumnsContext>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  const columns = use(ColumnsContext);
  return (
    <div aria-hidden="true" {...stylex.props(styles.grid, columns, styles.head)}>
      {children}
    </div>
  );
}

export type CellAlign = "start" | "end";

export function TableHeader({
  align = "start",
  children,
}: {
  align?: CellAlign;
  children: ReactNode;
}) {
  return <span {...stylex.props(styles.cell, align === "end" && styles.end)}>{children}</span>;
}

export interface TableRowsProps {
  label: string;
  value: string | null;
  onValueChange: (value: string) => void;
  children: ReactNode;
}

export function TableRows({ label, value, onValueChange, children }: TableRowsProps) {
  return (
    <Listbox<string>
      aria-label={label}
      value={value}
      activation="automatic"
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      className={cx(styles.rows)}
    >
      {children}
    </Listbox>
  );
}

export interface TableRowProps {
  value: string;
  label?: string;
  onOpen?: () => void;
  children: ReactNode;
}

export function TableRow({ value, label, onOpen, children }: TableRowProps) {
  const columns = use(ColumnsContext);
  return (
    <ListboxItem<string>
      value={value}
      {...(label === undefined ? {} : { label })}
      {...(onOpen === undefined
        ? {}
        : {
            onDoubleClick: onOpen,
            onKeyDown: (event: { key: string }) => {
              if (event.key === "Enter") onOpen();
            },
          })}
      {...columnsStyle(columns)}
      className={(s) =>
        cx(
          styles.grid,
          columns,
          styles.row,
          s.highlighted && styles.rowHighlighted,
          s.selected && styles.rowSelected,
        )
      }
    >
      {children}
    </ListboxItem>
  );
}

function columnsStyle(columns: stylex.StyleXStyles) {
  const style = stylex.props(columns).style;
  return style === undefined ? {} : { style };
}

export interface TableCellProps {
  align?: CellAlign;
  numeric?: boolean;
  children: ReactNode;
}

export function TableCell({ align = "start", numeric, children }: TableCellProps) {
  return (
    <span
      {...stylex.props(
        styles.cell,
        align === "end" && styles.end,
        numeric === true && styles.numeric,
      )}
    >
      {children}
    </span>
  );
}

export function RowTitle({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.rowTitle)}>{children}</span>;
}

export function RowReason({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.rowReason)}>{children}</span>;
}

export function TableEmpty({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.empty)}>{children}</div>;
}

const styles = stylex.create({
  table: { display: "flex", flexDirection: "column", minWidth: 0, containerType: "inline-size" },
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: { default: 0, [breakpoints.tableStacked]: space.s1 },
    paddingInline: space.s3,
  },
  head: {
    display: { default: "grid", [breakpoints.tableStacked]: "none" },
    height: 30,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  rows: { display: "flex", flexDirection: "column", gap: space.px2, outline: "none" },
  row: {
    position: "relative",
    minHeight: size.rowMinHeight,
    paddingBlock: space.s3,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: colors.textTertiary,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: -2,
  },
  rowHighlighted: {
    backgroundColor: { default: colors.bgHover, ":hover": colors.bgHover },
  },
  rowSelected: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
  },
  cell: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  end: { textAlign: "end", justifySelf: "end" },
  numeric: { fontVariantNumeric: "tabular-nums" },
  rowTitle: {
    display: "block",
    overflow: "hidden",
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  rowReason: {
    display: "flex",
    alignItems: "center",
    gap: space.px6,
    marginTop: space.px2,
    overflow: "hidden",
    fontSize: fontSize.ui,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  empty: {
    paddingBlock: space.s6,
    paddingInline: space.s3,
    color: colors.textTertiary,
    fontSize: fontSize.body,
  },
});
