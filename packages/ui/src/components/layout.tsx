import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { textStyles } from "./text";
import {
  colors,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  size,
  space,
} from "../tokens.stylex";

export interface SplitViewProps {
  list: ReactNode;
  panel: ReactNode;
  fill?: boolean;
  variant?: "list" | "editor";
}

export function SplitView({ list, panel, fill = true, variant = "list" }: SplitViewProps) {
  const editor = variant === "editor";
  return (
    <div {...stylex.props(styles.frame, fill ? styles.fill : styles.contained)}>
      <div {...stylex.props(styles.split, editor && styles.splitEditor)}>
        <div {...stylex.props(styles.list, editor && styles.listEditor)}>{list}</div>
        <aside {...stylex.props(styles.panel, editor && styles.panelEditor)}>{panel}</aside>
      </div>
    </div>
  );
}

export function NoticeLayout({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.notice)}>{children}</div>;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header {...stylex.props(styles.pageHead)}>
      <div>
        <h1 {...stylex.props(styles.pageTitle)}>{title}</h1>
        {subtitle === undefined ? null : <p {...stylex.props(styles.pageSub)}>{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export type SectionTitleRole = "heading" | "subheading";

export interface SectionProps {
  title: ReactNode;
  titleRole?: SectionTitleRole;
  count?: number;
  note?: ReactNode;
  link?: SectionLink;
  headingLevel?: "h2" | "h3";
  children: ReactNode;
}

export interface SectionLink {
  href: string;
  label: ReactNode;
}

export function Section({
  title,
  titleRole = "subheading",
  count,
  note,
  link,
  headingLevel,
  children,
}: SectionProps) {
  const Heading = headingLevel ?? (titleRole === "subheading" ? "h3" : "h2");
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <Heading {...stylex.props(textStyles(titleRole))}>{title}</Heading>
        {count === undefined ? null : <span {...stylex.props(styles.count)}>{count}</span>}
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
        {link === undefined ? null : (
          <a
            href={link.href}
            {...stylex.props(styles.sectionLink, note === undefined && styles.pushEnd)}
          >
            {link.label}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

export function DetailPanel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelInner)}>{children}</div>;
}

export interface PanelHeaderProps {
  status?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  reason?: ReactNode;
}

export function PanelHeader({ status, title, subtitle, reason }: PanelHeaderProps) {
  return (
    <div {...stylex.props(styles.panelHead)}>
      {status === undefined ? null : <div {...stylex.props(styles.panelState)}>{status}</div>}
      <h2 {...stylex.props(styles.panelTitle)}>{title}</h2>
      {subtitle === undefined ? null : <p {...stylex.props(styles.panelSub)}>{subtitle}</p>}
      {reason === undefined ? null : <p {...stylex.props(styles.panelReason)}>{reason}</p>}
    </div>
  );
}

export function PanelBlock({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {title === undefined ? null : <h3 {...stylex.props(styles.blockTitle)}>{title}</h3>}
      {children}
    </div>
  );
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelFoot)}>{children}</div>;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

const LIST_STACKED = "@container (max-width: 959px)";
const EDITOR_STACKED = "@container (max-width: 679px)";

const styles = stylex.create({
  notice: {
    maxWidth: size.noticeWidth,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  frame: { containerType: "inline-size", minHeight: 0 },
  split: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.panelWidth}`,
      [LIST_STACKED]: "minmax(0, 1fr)",
    },
    gridTemplateRows: { default: null, [LIST_STACKED]: "minmax(0, 1fr) minmax(0, 1fr)" },
    height: "100%",
    minHeight: 0,
  },
  splitEditor: {
    gridTemplateColumns: {
      default: `${size.editorListWidth} minmax(0, 1fr)`,
      [LIST_STACKED]: null,
      [EDITOR_STACKED]: "minmax(0, 1fr)",
    },
    gridTemplateRows: {
      default: null,
      [LIST_STACKED]: null,
      [EDITOR_STACKED]: "minmax(0, 2fr) minmax(0, 3fr)",
    },
  },
  fill: { height: "100dvh" },
  contained: { height: "100%" },
  list: {
    minWidth: 0,
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  listEditor: { paddingInline: space.s6 },
  panelEditor: { backgroundColor: colors.bgCanvas },
  panel: {
    minWidth: 0,
    overflow: "auto",
    backgroundColor: colors.bgPanel,
    scrollPaddingBlockEnd: "var(--pinned-toast-space, 0px)",
  },
  pageHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.s4,
    marginBottom: space.s6,
  },
  pageTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.page,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.page,
    textWrap: "balance",
  },
  pageSub: {
    margin: 0,
    marginTop: space.s1,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
  },
  section: {
    marginTop: { default: 0, ":not(:first-child)": space.s10 },
  },
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    marginBottom: space.s3,
  },
  count: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
  sectionLink: {
    flexShrink: 0,
    borderRadius: radius.pill,
    color: { default: colors.accentText, ":hover": colors.textPrimary },
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  pushEnd: { marginInlineStart: "auto" },
  note: {
    marginInlineStart: "auto",
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  panelInner: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    paddingTop: space.s8,
    paddingInline: space.s6,
    paddingBottom: space.s10,
  },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2 },
  panelState: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.ui,
  },
  panelTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.panel,
    textWrap: "pretty",
  },
  panelSub: { margin: 0, color: colors.textTertiary },
  panelReason: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  blockTitle: {
    margin: 0,
    marginBottom: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  panelFoot: {
    paddingTop: space.s4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});
