import { navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import type { MenuItemConstructorOptions } from "electron";

export function electronAccelerator(hotkey: string): string {
  return hotkey.replace(/^Mod\+/, "CommandOrControl+");
}

export function navigationMenu(options: {
  label: string;
  screenLabel: (screen: NavScreen) => string;
  enabled: boolean;
  onNavigate: (screen: NavScreen) => void;
}): MenuItemConstructorOptions {
  return {
    id: "navigate",
    label: options.label,
    submenu: navShortcuts.map((item) => ({
      id: `navigate-${item.screen}`,
      label: options.screenLabel(item.screen),
      accelerator: electronAccelerator(item.hotkey),
      enabled: options.enabled,
      click: () => options.onNavigate(item.screen),
    })),
  };
}
