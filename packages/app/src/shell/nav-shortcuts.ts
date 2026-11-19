export const navShortcuts = [
  { screen: "dashboard", path: "/", hotkey: "Mod+1" },
  { screen: "tickets", path: "/tickets", hotkey: "Mod+2" },
  { screen: "runs", path: "/runs", hotkey: "Mod+3" },
  { screen: "runners", path: "/runners", hotkey: "Mod+4" },
  { screen: "stats", path: "/stats", hotkey: "Mod+5" },
  { screen: "settings", path: "/settings", hotkey: "Mod+," },
] as const;

export type NavShortcut = (typeof navShortcuts)[number];
export type NavScreen = NavShortcut["screen"];

export const navScreens: ReadonlyArray<NavScreen> = navShortcuts.map((item) => item.screen);

export function navShortcutOf(screen: NavScreen): NavShortcut {
  const found = navShortcuts.find((item) => item.screen === screen);
  if (found === undefined) throw new Error(`unknown screen: ${screen}`);
  return found;
}

export function isNavScreen(value: unknown): value is NavScreen {
  return typeof value === "string" && navScreens.some((screen) => screen === value);
}

export function navPathKeepingWorkspace(screen: NavScreen, currentSearch: string): string {
  const workspace = new URLSearchParams(currentSearch).get("ws");
  const path = navShortcutOf(screen).path;
  return workspace === null ? path : `${path}?${new URLSearchParams({ ws: workspace }).toString()}`;
}

export const DESKTOP_NAVIGATION_GLOBAL = "gangerDesktopNavigation";
