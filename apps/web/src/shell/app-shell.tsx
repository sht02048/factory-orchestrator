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
  Tooltip,
  WorkspaceBadge,
  railLinkStyles,
} from "@ganger/ui";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { ALL_WORKSPACES } from "@ganger/app/shell/model";
import type { ShellData, WorkspaceChoice } from "@ganger/app/shell/model";
import { navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen, NavShortcut } from "@ganger/app/shell/nav-shortcuts";
import { navIcons } from "./nav-icons";
import { useDesktopNavigation } from "./desktop-navigation";

const mainItems = navShortcuts.filter((item) => item.screen !== "settings");
const bottomItems = navShortcuts.filter((item) => item.screen === "settings");

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
  const railLinks = useRef(new Map<NavScreen, HTMLAnchorElement>());
  const { inDesktopApp } = useDesktopNavigation((screen) => railLinks.current.get(screen)?.focus());
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
            {[mainItems, bottomItems].map((items) => (
              <RailNavList key={items[0]?.screen}>
                {items.map((item) => (
                  <li key={item.screen}>
                    <RailLink
                      item={item}
                      current={isCurrent(item.path)}
                      issues={item.screen === "runners" ? shell.runnerIssues : 0}
                      showShortcut={inDesktopApp}
                      linkRef={(element) => {
                        if (element === null) railLinks.current.delete(item.screen);
                        else railLinks.current.set(item.screen, element);
                      }}
                    />
                  </li>
                ))}
              </RailNavList>
            ))}
          </RailNav>
        </>
      }
    >
      {children}
    </AppFrame>
  );
}

function RailLink({
  item,
  current,
  issues,
  showShortcut,
  linkRef,
}: {
  item: NavShortcut;
  current: boolean;
  issues: number;
  showShortcut: boolean;
  linkRef: (element: HTMLAnchorElement | null) => void;
}) {
  const t = useTranslations("shell");
  const name = t(`nav.${item.screen}`);
  return (
    <Tooltip
      content={issues > 0 ? t("nav.withIssues", { name, count: issues }) : name}
      labelsTrigger
      side="right"
      disabled={!showShortcut && issues === 0}
      {...(showShortcut ? { shortcut: item.shortcut } : {})}
      render={
        <Link
          ref={linkRef}
          to={item.path}
          {...(current ? { "aria-current": "page" } : {})}
          {...stylex.props(railLinkStyles(current))}
        />
      }
    >
      <RailLinkContent icon={navIcons[item.screen]} name={name} issues={issues} />
    </Tooltip>
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
