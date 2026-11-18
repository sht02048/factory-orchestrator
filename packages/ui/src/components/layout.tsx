import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import {
  colors,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  size,
  space,
} from "../tokens.stylex";

/*
 * 화면 틀(ADR 0007): 목록 | 오른쪽 상세 패널. 영역은 면(배경색)과 여백으로 나눈다(ADR 0010).
 */

export interface SplitViewProps {
  /** 왼쪽 목록 영역. */
  list: ReactNode;
  /** 오른쪽 상세 패널. DetailPanel 을 넘긴다. */
  panel: ReactNode;
  /** 화면 높이를 채울지. 미리보기처럼 다른 내용 안에 넣을 때 false. */
  fill?: boolean;
  /**
   * list: 넓은 목록 + `panelWidth` 상세 패널(운영 화면).
   * editor: 좁은 항목 목록 + 넓은 편집 영역(Settings, ADR 0007). 편집 영역은 화면 바탕과 같은 색이다.
   */
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

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 오른쪽 끝 행동(버튼). */
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

export interface SectionProps {
  title: ReactNode;
  /** 제목 옆 개수. */
  count?: number;
  /** 오른쪽 끝 흐린 메모. */
  note?: ReactNode;
  children: ReactNode;
}

/** 목록 화면의 구역. 구역 사이는 여백으로만 나눈다. */
export function Section({ title, count, note, children }: SectionProps) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
        {count === undefined ? null : <span {...stylex.props(styles.count)}>{count}</span>}
        {note === undefined ? null : <span {...stylex.props(styles.note)}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 상세 패널 안쪽. 머리(PanelHeader), 블록(PanelBlock), 바닥(PanelFooter)을 차례로 둔다. */
export function DetailPanel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelInner)}>{children}</div>;
}

export interface PanelHeaderProps {
  /** 제목 위 상태 줄(Status 와 흐린 메타). */
  status?: ReactNode;
  title: ReactNode;
  /** 제목 아래 흐린 한 줄(티켓 ID · 프로젝트). */
  subtitle?: ReactNode;
  /** 상태의 이유. 왜 손을 대야 하는지 한두 문장. */
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

/** 패널 안 묶음. 작은 흐린 제목 아래 내용을 둔다. */
export function PanelBlock({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {title === undefined ? null : <h3 {...stylex.props(styles.blockTitle)}>{title}</h3>}
      {children}
    </div>
  );
}

/** 패널 맨 아래. 위에 옅은 선을 긋는다. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.panelFoot)}>{children}</div>;
}

/** 버튼 줄. 주 버튼을 맨 앞에 둔다. */
export function Actions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

const LIST_STACKED = "@container (max-width: 959px)";
const EDITOR_STACKED = "@container (max-width: 679px)";

const styles = stylex.create({
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
    paddingBottom: space.s10,
  },
  listEditor: { paddingInline: space.s6 },
  panelEditor: { backgroundColor: colors.bgCanvas },
  panel: {
    minWidth: 0,
    overflow: "auto",
    // 목록과 패널은 선이 아니라 면(배경색)으로 나눈다(ADR 0010 10번).
    backgroundColor: colors.bgPanel,
  },
  pageHead: {
    display: "flex",
    // 좁은 화면에서 오른쪽 행동(개수 타일 등)이 제목·요약을 짓누르지 않고 다음 줄로 내려간다.
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
    marginBottom: space.s2,
  },
  sectionTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  count: { color: colors.textTertiary, fontVariantNumeric: "tabular-nums" },
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
