import * as stylex from "@stylexjs/stylex";
import { createContext, use, type MouseEventHandler, type ReactNode } from "react";
import { colors, fontWeight, radius, size, space } from "../tokens.stylex";
import { textStyles } from "./text";
import { visuallyHiddenStyles } from "./visually-hidden";

export type DataTableDensity = "normal" | "compact";

interface TableSettings {
  density: DataTableDensity;
  framed: boolean;
}

const SettingsContext = createContext<TableSettings>({ density: "normal", framed: false });

export interface DataTableProps {
  label?: string;
  caption?: ReactNode;
  captionHidden?: boolean;
  density?: DataTableDensity;
  framed?: boolean;
  fixed?: boolean;
  id?: string;
  columnWidths?: ReadonlyArray<string | null>;
  children: ReactNode;
}

export function DataTable({
  label,
  caption,
  captionHidden,
  density = "normal",
  framed = false,
  fixed,
  id,
  columnWidths,
  children,
}: DataTableProps) {
  const table = (
    <table
      {...(id === undefined ? {} : { id })}
      {...(label === undefined ? {} : { "aria-label": label })}
      {...stylex.props(
        styles.table,
        fixed === true && styles.fixed,
        framed && styles.framedTable,
        density === "compact" && styles.compactTable,
      )}
    >
      {caption === undefined ? null : (
        <caption
          {...stylex.props(
            captionHidden === true ? visuallyHiddenStyles.hidden : textStyles("label"),
            styles.caption,
          )}
        >
          {caption}
        </caption>
      )}
      {columnWidths === undefined ? null : (
        <colgroup>
          {columnWidths.map((width, i) => (
            <col key={i} {...(width === null ? {} : { style: { width } })} />
          ))}
        </colgroup>
      )}
      <SettingsContext value={{ density, framed }}>{children}</SettingsContext>
    </table>
  );
  return framed ? <div {...stylex.props(styles.frame)}>{table}</div> : table;
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export type DataCellAlign = "start" | "end";

export interface DataTableHeaderProps {
  align?: DataCellAlign;
  shrink?: boolean;
  children: ReactNode;
}

export function DataTableHeader({ align = "start", shrink, children }: DataTableHeaderProps) {
  const { density, framed } = use(SettingsContext);
  return (
    <th
      scope="col"
      {...stylex.props(
        textStyles("label"),
        styles.cell,
        styles.header,
        density === "compact" && styles.compact,
        framed && styles.framedCell,
        align === "end" && styles.end,
        shrink === true && styles.shrink,
      )}
    >
      {children}
    </th>
  );
}

export interface DataTableRowProps {
  onClick?: MouseEventHandler<HTMLTableRowElement>;
  divided?: boolean;
  children: ReactNode;
}

export function DataTableRow({ onClick, divided = true, children }: DataTableRowProps) {
  return (
    <tr
      {...(onClick === undefined ? {} : { onClick })}
      {...stylex.props(divided && styles.divided, onClick !== undefined && styles.openable)}
    >
      {children}
    </tr>
  );
}

export interface DataTableCellProps {
  align?: DataCellAlign;
  numeric?: boolean;
  truncate?: boolean;
  wide?: boolean;
  colSpan?: number;
  children?: ReactNode;
}

function useCellStyles({ align = "start", numeric, truncate, wide }: DataTableCellProps) {
  const { density, framed } = use(SettingsContext);
  return [
    styles.cell,
    styles.body,
    density === "compact" && styles.compact,
    framed && styles.framedCell,
    align === "end" && styles.end,
    numeric === true && styles.numeric,
    truncate === true && styles.truncate,
    wide === true && styles.wide,
  ] as const;
}

export function DataTableRowHeader(props: DataTableCellProps & { strong?: boolean }) {
  const cell = useCellStyles(props);
  return (
    <th
      scope="row"
      {...stylex.props(
        textStyles(props.strong === true ? "title" : "ui"),
        props.strong !== true && styles.regular,
        cell,
      )}
    >
      {props.children}
    </th>
  );
}

export function DataTableCell(props: DataTableCellProps) {
  const cell = useCellStyles(props);
  return (
    <td
      {...(props.colSpan === undefined ? {} : { colSpan: props.colSpan })}
      {...stylex.props(textStyles("ui"), cell)}
    >
      {props.children}
    </td>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    overflowX: "auto",
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  table: { width: "100%", borderCollapse: "collapse" },
  fixed: { tableLayout: "fixed" },
  framedTable: { minWidth: size.mappingTableMinWidth },
  compactTable: { fontVariantNumeric: "tabular-nums" },
  caption: { textAlign: "start", paddingBottom: space.s1 },
  cell: {
    paddingBlock: space.s3,
    paddingInline: space.s3,
    textAlign: "start",
    verticalAlign: "middle",
  },
  header: { paddingBlock: space.s2, whiteSpace: "nowrap" },
  body: { height: size.rowMinHeight },
  compact: { height: "auto", paddingBlock: space.s1, paddingInline: space.s2 },
  framedCell: {
    paddingInlineStart: { default: space.s2, ":first-child": space.s5 },
    paddingInlineEnd: { default: space.s2, ":last-child": space.s5 },
  },
  regular: { fontWeight: fontWeight.regular },
  divided: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  openable: { cursor: "pointer" },
  end: { textAlign: "end" },
  numeric: { fontVariantNumeric: "tabular-nums" },
  truncate: { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  wide: { minWidth: size.mappingCellMinWidth },
  shrink: { width: 0 },
});
