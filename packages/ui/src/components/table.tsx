import * as stylex from "@stylexjs/stylex";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { createContext, use, type ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, motion, size, space } from "../tokens.stylex";

/*
 * 목록 표: 정렬된 열(ADR 0007). 행을 고르면 오른쪽 상세 패널이 바뀐다.
 * 행 선택과 위아래 화살표 이동은 UI SDK Listbox 가 맡는다.
 *
 * <Table columns="minmax(0, 1fr) 80px 56px">
 *   <TableHead><TableHeader>…</TableHeader>…</TableHead>
 *   <TableRows label="…" value={sel} onValueChange={setSel}>
 *     <TableRow value="1051"><TableCell>…</TableCell>…</TableRow>
 *   </TableRows>
 * </Table>
 */

const ColumnsContext = createContext<string>("minmax(0, 1fr)");

export interface TableProps {
  /** CSS grid-template-columns 값. 첫 열(제목)은 minmax(0, 1fr), 나머지는 고정 폭으로 둔다. */
  columns: string;
  children: ReactNode;
}

export function Table({ columns, children }: TableProps) {
  return (
    <ColumnsContext value={columns}>
      <div {...stylex.props(styles.table)}>{children}</div>
    </ColumnsContext>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  const columns = use(ColumnsContext);
  return (
    <div
      aria-hidden="true"
      style={{ gridTemplateColumns: columns }}
      className={cx(styles.grid, styles.head)}
    >
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
  /** 목록의 접근 가능한 이름. 메시지 파일의 글을 넘긴다. */
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
  /** 행의 접근 가능한 이름(보통 제목). 없으면 행의 글 전체를 읽는다. */
  label?: string;
  /** 두 번 누르거나 Enter 로 상세 화면을 열 때. */
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
      style={{ gridTemplateColumns: columns }}
      className={(s) =>
        cx(
          styles.grid,
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

export interface TableCellProps {
  align?: CellAlign;
  /** 숫자 열. tabular-nums 로 자릿수를 맞춘다. */
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

/** 행 제목. 행에서 가장 밝고 굵은 글이다. */
export function RowTitle({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.rowTitle)}>{children}</span>;
}

/** 손댈 일 행에만 붙이는 이유 한 줄. 앞에 Dot 을 둘 수 있다. */
export function RowReason({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.rowReason)}>{children}</span>;
}

/** 목록이 비었을 때 한 줄. */
export function TableEmpty({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.empty)}>{children}</div>;
}

const styles = stylex.create({
  table: { display: "flex", flexDirection: "column", minWidth: 0 },
  // 열 폭(gridTemplateColumns)은 Table 의 columns 값으로 행마다 inline style 로 준다.
  grid: {
    display: "grid",
    alignItems: "center",
    columnGap: space.s3,
    paddingInline: space.s3,
  },
  head: {
    height: 30,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  rows: { display: "flex", flexDirection: "column", outline: "none" },
  row: {
    position: "relative",
    minHeight: size.rowMinHeight,
    paddingBlock: space.s3,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
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
    borderTopColor: "transparent",
    boxShadow: `inset 2px 0 0 ${colors.accentText}`,
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
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
    color: colors.textTertiary,
    fontSize: fontSize.body,
  },
});
