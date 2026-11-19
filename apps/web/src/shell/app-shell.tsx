import * as stylex from "@stylexjs/stylex";
import {
  AppFrame,
  GangerMark,
  Menu,
  MenuRadio,
  MenuRadioOption,
  MenuSeparator,
  RailBrand,
  RailLinkContent,
  RailNav,
  RailNavList,
  RailStatic,
  WorkspaceBadge,
  railLinkStyles,
} from "@ganger/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { ALL_WORKSPACES } from "@ganger/app/shell/model";
import type { ShellData, WorkspaceChoice } from "@ganger/app/shell/model";
import { navIcons } from "./nav-icons";

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
    <AppFrame
      rail={
        <>
          <RailBrand>
            <GangerMark tone="brand" label={t("brand")} />
          </RailBrand>
          <WorkspaceSwitcher
            shell={shell}
            workspace={workspace}
            onWorkspaceChange={onWorkspaceChange}
          />
          <RailNav label={t("nav.label")}>
            <RailNavList>
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
            </RailNavList>
            <RailNavList>
              <li>
                <RailLink
                  navKey="settings"
                  to="/settings"
                  current={isCurrent("/settings")}
                  issues={0}
                />
              </li>
            </RailNavList>
          </RailNav>
        </>
      }
    >
      {children}
    </AppFrame>
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
      {...stylex.props(railLinkStyles(current))}
    >
      <RailLinkContent icon={navIcons[navKey]} name={name} issues={issues} />
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
      <RailStatic>
        <WorkspaceBadge name={t("none")} initial={null} />
      </RailStatic>
    );
  }
  const name = workspace.kind === "all" ? t("all") : workspace.workspace.name;
  const value = workspace.kind === "all" ? ALL_WORKSPACES : workspace.workspace.id;
  return (
    <Menu
      variant="rail"
      label={t("switch", { workspace: name })}
      trigger={<WorkspaceBadge name={name} initial={initialOf(name)} />}
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
