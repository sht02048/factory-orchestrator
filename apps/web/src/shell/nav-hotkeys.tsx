import { navShortcutOf, navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { desktopNavigation } from "./desktop-navigation";

const takesKeyFromBrowser = true;

export function NavHotkeys() {
  const navigate = useNavigate();
  const [menuOwnsKeys, setMenuOwnsKeys] = useState(false);

  useEffect(() => {
    const bridge = desktopNavigation();
    if (bridge === null) return;
    setMenuOwnsKeys(true);
    return bridge.onNavigate((screen) => {
      void navigate({ to: navShortcutOf(screen).path });
    });
  }, [navigate]);

  useHotkeys(
    navShortcuts.map((item) => ({
      hotkey: item.hotkey,
      callback: () => {
        void navigate({ to: item.path });
      },
      options: { meta: { name: item.screen } },
    })),
    { enabled: !menuOwnsKeys, preventDefault: takesKeyFromBrowser },
  );

  return null;
}
