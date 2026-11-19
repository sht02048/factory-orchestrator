import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { ReactNode, Ref } from "react";
import { textStyles } from "./text";
import { colors, fontSize, radius, size, space } from "../tokens.stylex";

export interface KanbanColumnProps {
  title: string;
  count: number;
  note?: ReactNode;
  children: ReactNode;
}

export function KanbanColumn({ title, count, note, children }: KanbanColumnProps) {
  return (
    <section aria-label={title} data-column="" {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.columnHead)}>
        <h2 {...stylex.props(textStyles("subheading"), styles.columnTitle)}>{title}</h2>
        <span {...stylex.props(styles.count)}>{count}</span>
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function KanbanCards({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.cards)}>{children}</ul>;
}

export function KanbanSubheading({ children }: { children: ReactNode }) {
  return <p {...stylex.props(textStyles("label"), styles.subheading)}>{children}</p>;
}

export interface KanbanCardProps {
  tag?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  time?: ReactNode;
  action?: ReactNode;
  onOpen: () => void;
  openRef?: Ref<HTMLButtonElement>;
  selected?: boolean;
  titleId?: string;
}

export function KanbanCard({
  tag,
  title,
  detail,
  meta,
  time,
  action,
  onOpen,
  openRef,
  selected = false,
  titleId,
}: KanbanCardProps) {
  const ownId = useId();
  const nameId = titleId ?? `${ownId}title`;
  const tagId = `${ownId}tag`;
  const detailId = `${ownId}detail`;
  const footId = `${ownId}foot`;
  const hasFoot = meta !== undefined || time !== undefined || action !== undefined;
  const described = [
    tag === undefined ? null : tagId,
    detail === undefined ? null : detailId,
    hasFoot ? footId : null,
  ].filter((id) => id !== null);
  return (
    <div {...stylex.props(styles.card)}>
      <button
        type="button"
        {...(openRef === undefined ? {} : { ref: openRef })}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-labelledby={nameId}
        {...(described.length === 0 ? {} : { "aria-describedby": described.join(" ") })}
        onClick={onOpen}
        {...stylex.props(styles.open, selected && styles.selected)}
      >
        {tag === undefined ? null : (
          <span id={tagId} {...stylex.props(styles.tag)}>
            {tag}
          </span>
        )}
        <span id={nameId} {...stylex.props(styles.title)}>
          {title}
        </span>
        {detail === undefined ? null : (
          <span id={detailId} {...stylex.props(textStyles("ui"), styles.detail)}>
            {detail}
          </span>
        )}
        {hasFoot ? (
          <span
            id={footId}
            {...stylex.props(styles.foot, action !== undefined && styles.footWithAction)}
          >
            <span {...stylex.props(textStyles("meta"), styles.meta)}>{meta}</span>
            {time === undefined ? null : (
              <span {...stylex.props(textStyles("meta"), styles.time)}>{time}</span>
            )}
          </span>
        ) : null}
      </button>
      {action === undefined ? null : <span {...stylex.props(styles.action)}>{action}</span>}
    </div>
  );
}

const styles = stylex.create({
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    padding: space.s3,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  columnHead: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    minWidth: 0,
    paddingInline: space.s1,
    paddingTop: space.s1,
  },
  columnTitle: { margin: 0 },
  count: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
  note: {
    marginInlineStart: "auto",
    color: colors.textTertiary,
    fontSize: fontSize.small,
    textAlign: "end",
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  subheading: {
    margin: 0,
    paddingInline: space.s1,
    paddingTop: space.s2,
  },
  card: { position: "relative", minWidth: 0 },
  open: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s1,
    width: "100%",
    minWidth: 0,
    margin: 0,
    padding: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: colors.bgRaised,
      ":hover": { default: null, "@media (hover: hover)": colors.bgRaisedHover },
    },
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  selected: { boxShadow: `inset 0 0 0 1px ${colors.borderSelected}` },
  tag: { display: "flex", paddingBottom: space.s1 },
  title: { display: "block", minWidth: 0, overflowWrap: "anywhere" },
  detail: {
    display: "-webkit-box",
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  foot: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    minWidth: 0,
    paddingTop: space.s1,
  },
  footWithAction: {
    alignItems: "center",
    minHeight: size.control,
    paddingInlineEnd: size.rowActionColumn,
  },
  meta: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  time: { flexShrink: 0, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  action: {
    position: "absolute",
    insetInlineEnd: space.s3,
    insetBlockEnd: space.s3,
    display: "flex",
    justifyContent: "flex-end",
  },
});
