import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { StyleArg } from "../cx";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  size,
  space,
} from "../tokens.stylex";
import { focusStyles } from "./focus";

export interface AppFrameProps {
  rail: ReactNode;
  fill?: boolean;
  children: ReactNode;
}

export function AppFrame({ rail, fill = true, children }: AppFrameProps) {
  return (
    <div {...stylex.props(styles.app, fill ? styles.fill : styles.contained)}>
      <aside {...stylex.props(styles.rail)}>{rail}</aside>
      <main {...stylex.props(styles.main)}>{children}</main>
    </div>
  );
}

export function RailBrand({ children }: { children: ReactNode }) {
  return (
    <div data-rail-brand {...stylex.props(styles.brand)}>
      {children}
    </div>
  );
}

export function RailNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      {children}
    </nav>
  );
}

export function RailNavList({ children }: { children: ReactNode }) {
  return <ul {...stylex.props(styles.navList)}>{children}</ul>;
}

export function railLinkStyles(current: boolean): ReadonlyArray<StyleArg> {
  return [styles.navLink, focusStyles.ringInset, current && styles.navLinkCurrent];
}

export interface RailLinkContentProps {
  icon: ReactNode;
  name: ReactNode;
  issues: number;
}

export function RailLinkContent({ icon, name, issues }: RailLinkContentProps) {
  return (
    <>
      <span {...stylex.props(styles.iconBox)}>
        {icon}
        {issues > 0 ? (
          <span aria-hidden="true" data-issues={issues} {...stylex.props(styles.issueDot)}>
            {issues}
          </span>
        ) : null}
      </span>
      <span {...stylex.props(styles.ellipsis)}>{name}</span>
    </>
  );
}

export function WorkspaceBadge({ name, initial }: { name: ReactNode; initial: string | null }) {
  return (
    <>
      <span
        aria-hidden="true"
        {...stylex.props(styles.avatar, initial === null && styles.avatarEmpty)}
      >
        {initial}
      </span>
      <span {...stylex.props(styles.ellipsis, styles.workspaceName)}>{name}</span>
    </>
  );
}

export function RailStatic({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.workspace)}>{children}</div>;
}

const styles = stylex.create({
  app: {
    display: "grid",
    gridTemplateColumns: `${size.railWidth} minmax(0, 1fr)`,
  },
  fill: { height: "100dvh" },
  contained: { height: "100%" },
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minHeight: 0,
    paddingBlock: space.s4,
    paddingInline: space.s2,
    overflow: "auto",
    backgroundColor: colors.bgSidebar,
  },
  brand: {
    display: "flex",
    justifyContent: "center",
    paddingTop: space.s1,
    color: colors.textPrimary,
  },
  workspace: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s2,
  },
  avatar: {
    display: "grid",
    placeItems: "center",
    width: size.railAvatar,
    height: size.railAvatar,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  avatarEmpty: { backgroundColor: colors.bgControl },
  ellipsis: {
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  workspaceName: {
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    flexGrow: 1,
    gap: space.s4,
  },
  navList: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  navLink: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s2,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    fontSize: fontSize.small,
    textDecoration: "none",
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  navLinkCurrent: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    color: { default: colors.accentText, ":hover": colors.accentText },
  },
  iconBox: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: size.railIcon,
    height: size.railIcon,
  },
  issueDot: {
    position: "absolute",
    top: -4,
    insetInlineEnd: -8,
    display: "grid",
    placeItems: "center",
    minWidth: size.issueBadge,
    height: size.issueBadge,
    paddingInline: space.px2,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
    color: colors.textOnProblem,
    fontSize: fontSize.label,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  main: { minWidth: 0, minHeight: 0, overflow: "hidden" },
});

export const documentStyles = stylex.create({
  body: {
    margin: 0,
    backgroundColor: colors.bgCanvas,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    fontSynthesis: "none",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
  },
});
