import * as stylex from "@stylexjs/stylex";
import { Menu, MenuRadio, MenuRadioOption, MenuSeparator } from "@factory/ui";
import { colors, fontSize, fontWeight, motion, radius, space } from "@factory/ui/tokens.stylex";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { ALL_WORKSPACES } from "./model";
import type { ShellData, WorkspaceChoice } from "./model";
import { navIcons } from "./nav-icons";

const RAIL_WIDTH = 84;

const menuItems = [
  { key: "dashboard", to: "/" },
  { key: "tickets", to: "/tickets" },
  { key: "runs", to: "/runs" },
  { key: "runners", to: "/runners" },
  { key: "stats", to: "/stats" },
] as const;

type NavKey = (typeof menuItems)[number]["key"] | "settings";

export interface AppShellProps {
  shell: ShellData;
  workspace: WorkspaceChoice;
  pathname: string;
  onWorkspaceChange: (ws: string) => void;
  children: ReactNode;
}

export function AppShell({
  shell,
  workspace,
  pathname,
  onWorkspaceChange,
  children,
}: AppShellProps) {
  const t = useTranslations("shell");
  const isCurrent = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <div {...stylex.props(styles.app)}>
      <aside {...stylex.props(styles.rail)}>
        <WorkspaceSwitcher
          shell={shell}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
        />
        <nav aria-label={t("nav.label")} {...stylex.props(styles.nav)}>
          <ul {...stylex.props(styles.navList)}>
            {menuItems.map((item) => (
              <li key={item.key}>
                <RailLink
                  navKey={item.key}
                  to={item.to}
                  current={isCurrent(item.to)}
                  issues={item.key === "runners" ? shell.runnerIssues : 0}
                />
              </li>
            ))}
          </ul>
          <ul {...stylex.props(styles.navList)}>
            <li>
              <RailLink
                navKey="settings"
                to="/settings"
                current={isCurrent("/settings")}
                issues={0}
              />
            </li>
          </ul>
        </nav>
      </aside>
      <main {...stylex.props(styles.main)}>{children}</main>
    </div>
  );
}

function RailLink({
  navKey,
  to,
  current,
  issues,
}: {
  navKey: NavKey;
  to: string;
  current: boolean;
  issues: number;
}) {
  const t = useTranslations("shell");
  const name = t(`nav.${navKey}`);
  return (
    <Link
      to={to}
      {...(current ? { "aria-current": "page" } : {})}
      {...(issues > 0 ? { "aria-label": t("nav.withIssues", { name, count: issues }) } : {})}
      {...stylex.props(styles.navLink, current && styles.navLinkCurrent)}
    >
      <span {...stylex.props(styles.iconBox)}>
        {navIcons[navKey]}
        {issues > 0 ? (
          <span aria-hidden="true" data-issues={issues} {...stylex.props(styles.issueDot)}>
            {issues}
          </span>
        ) : null}
      </span>
      <span {...stylex.props(styles.navName)}>{name}</span>
    </Link>
  );
}

function WorkspaceSwitcher({
  shell,
  workspace,
  onWorkspaceChange,
}: Pick<AppShellProps, "shell" | "workspace" | "onWorkspaceChange">) {
  const t = useTranslations("shell.workspace");
  if (workspace.kind === "none") {
    return (
      <div {...stylex.props(styles.workspace)}>
        <span aria-hidden="true" {...stylex.props(styles.avatar, styles.avatarEmpty)} />
        <span {...stylex.props(styles.workspaceName)}>{t("none")}</span>
      </div>
    );
  }
  const name = workspace.kind === "all" ? t("all") : workspace.workspace.name;
  const value = workspace.kind === "all" ? ALL_WORKSPACES : workspace.workspace.id;
  return (
    <Menu
      variant="rail"
      label={t("switch", { workspace: name })}
      trigger={
        <>
          <span aria-hidden="true" {...stylex.props(styles.avatar)}>
            {initialOf(name)}
          </span>
          <span {...stylex.props(styles.workspaceName)}>{name}</span>
        </>
      }
    >
      <MenuRadio value={value} onValueChange={onWorkspaceChange}>
        {shell.workspaces.map((w) => (
          <MenuRadioOption key={w.id} value={w.id}>
            {w.name}
          </MenuRadioOption>
        ))}
        <MenuSeparator />
        <MenuRadioOption value={ALL_WORKSPACES}>{t("all")}</MenuRadioOption>
      </MenuRadio>
    </Menu>
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function initialOf(name: string): string {
  const [first] = graphemes.segment(name.trim());
  return first?.segment.toUpperCase() ?? "";
}

const focusRing = {
  outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  outlineOffset: -2,
} as const;

const styles = stylex.create({
  app: {
    display: "grid",
    gridTemplateColumns: `${RAIL_WIDTH}px minmax(0, 1fr)`,
    height: "100dvh",
  },
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
    width: 36,
    height: 36,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  avatarEmpty: { backgroundColor: colors.bgControl },
  workspaceName: {
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
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
    ...focusRing,
  },
  navLinkCurrent: {
    backgroundColor: { default: colors.bgSelected, ":hover": colors.bgSelected },
    color: { default: colors.textPrimary, ":hover": colors.textPrimary },
  },
  iconBox: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
  },
  issueDot: {
    position: "absolute",
    top: -4,
    insetInlineEnd: -8,
    display: "grid",
    placeItems: "center",
    minWidth: 16,
    height: 16,
    paddingInline: space.px2,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
    color: colors.textOnProblem,
    fontSize: fontSize.label,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  navName: {
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  main: { minWidth: 0, minHeight: 0, overflow: "hidden" },
});
