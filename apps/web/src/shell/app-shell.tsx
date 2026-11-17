import * as stylex from "@stylexjs/stylex";
import { Dot, Menu, MenuRadio, MenuRadioOption, MenuSeparator } from "@factory/ui";
import {
  colors,
  fontSize,
  fontWeight,
  letterSpacing,
  motion,
  radius,
  size,
  space,
} from "@factory/ui/tokens.stylex";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { ALL_WORKSPACES } from "./model";
import type { ShellData, WorkspaceChoice } from "./model";
import { navIcons } from "./nav-icons";

/*
 * 앱 셸(시안 B): 사이드바(Workspace 전환기, 내비, RUNNERS) | 본문.
 * 내비 항목은 모든 화면을 여기 둔다. 화면 티켓은 라우트만 더하고 셸을 고치지 않는다.
 */

const navItems = [
  { key: "home", to: "/" },
  { key: "tickets", to: "/tickets" },
  { key: "runs", to: "/runs" },
  { key: "runners", to: "/runners" },
  { key: "stats", to: "/stats" },
  { key: "settings", to: "/settings" },
] as const;

export interface AppShellProps {
  shell: ShellData;
  workspace: WorkspaceChoice;
  /** 지금 주소의 경로. 내비에서 현재 화면을 표시한다 */
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
  return (
    <div {...stylex.props(styles.app)}>
      <aside {...stylex.props(styles.sidebar)}>
        <Link to="/" {...stylex.props(styles.brand)}>
          <span aria-hidden="true" {...stylex.props(styles.brandMark)}>
            {t("brandMark")}
          </span>
          {t("brand")}
        </Link>
        <WorkspaceSwitcher
          shell={shell}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
        />
        <nav aria-label={t("nav.label")}>
          <ul {...stylex.props(styles.navList)}>
            {navItems.map((item) => {
              const current =
                item.to === "/"
                  ? pathname === "/"
                  : pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    {...(current ? { "aria-current": "page" } : {})}
                    {...stylex.props(styles.navLink, current && styles.navLinkCurrent)}
                  >
                    {navIcons[item.key]}
                    {t(`nav.${item.key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section aria-labelledby="sidebar-runners" {...stylex.props(styles.runners)}>
          <h2 id="sidebar-runners" {...stylex.props(styles.sectionLabel)}>
            {t("runners.title")}
          </h2>
          {shell.runners.length === 0 ? (
            <p {...stylex.props(styles.runnersEmpty)}>{t("runners.empty")}</p>
          ) : (
            <ul {...stylex.props(styles.navList)}>
              {shell.runners.map((runner) => (
                <li key={runner.id}>
                  <Link
                    to="/runners"
                    search={(prev) => ({ ws: prev.ws, sel: runner.id })}
                    {...stylex.props(styles.runner)}
                  >
                    {runner.online ? (
                      <Dot tone="online" label={t("runners.online")} />
                    ) : (
                      <Dot tone="offline" />
                    )}
                    <span {...stylex.props(styles.runnerName)}>{runner.name}</span>
                    <span {...stylex.props(styles.runnerLoad)}>
                      {runner.online
                        ? t("runners.load", {
                            running: runner.occupied,
                            capacity: runner.capacity,
                          })
                        : t("runners.offline")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <main {...stylex.props(styles.main)}>{children}</main>
    </div>
  );
}

function WorkspaceSwitcher({
  shell,
  workspace,
  onWorkspaceChange,
}: Pick<AppShellProps, "shell" | "workspace" | "onWorkspaceChange">) {
  const t = useTranslations("shell.workspace");
  if (workspace.kind === "none") {
    return <p {...stylex.props(styles.noWorkspace)}>{t("none")}</p>;
  }
  const value = workspace.kind === "all" ? ALL_WORKSPACES : workspace.workspace.id;
  return (
    <Menu
      label={t("label")}
      trigger={workspace.kind === "all" ? t("all") : workspace.workspace.name}
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

const focusRing = {
  outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  outlineOffset: -2,
} as const;

const styles = stylex.create({
  app: {
    display: "grid",
    gridTemplateColumns: `${size.sidebarWidth} minmax(0, 1fr)`,
    height: "100dvh",
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minHeight: 0,
    paddingBlock: space.s3,
    paddingInline: space.s2,
    overflow: "auto",
    backgroundColor: colors.bgSidebar,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colors.borderSubtle,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    textDecoration: "none",
    ...focusRing,
  },
  brandMark: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
    fontSize: fontSize.small,
  },
  noWorkspace: {
    paddingInline: space.s2,
    color: colors.textTertiary,
  },
  navList: { display: "flex", flexDirection: "column", gap: space.px2 },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: 30,
    paddingInline: space.s2,
    borderRadius: radius.md,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontWeight: fontWeight.medium,
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
  runners: { display: "flex", flexDirection: "column", gap: space.s1 },
  sectionLabel: {
    margin: 0,
    paddingInline: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.label,
    textTransform: "uppercase",
  },
  runnersEmpty: {
    paddingInline: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
  },
  runner: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: 28,
    paddingInline: space.s2,
    borderRadius: radius.md,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    textDecoration: "none",
    ...focusRing,
  },
  runnerName: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  runnerLoad: {
    marginInlineStart: "auto",
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  main: { minWidth: 0, minHeight: 0, overflow: "hidden" },
});
