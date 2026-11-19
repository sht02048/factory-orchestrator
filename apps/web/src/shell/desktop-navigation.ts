import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  DESKTOP_NAVIGATION_GLOBAL,
  isNavScreen,
  navShortcutOf,
} from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";

export interface DesktopNavigation {
  onNavigate(listener: (screen: NavScreen) => void): () => void;
}

const unsubscribeSchema = z.custom<() => unknown>((value) => typeof value === "function");

const bridgeSchema = z.object({
  onNavigate: z.custom<(listener: (screen: unknown) => void) => unknown>(
    (value) => typeof value === "function",
  ),
});

export function desktopNavigation(scope: object = globalThis): DesktopNavigation | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_NAVIGATION_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  return {
    onNavigate(listener) {
      const off = unsubscribeSchema.safeParse(
        bridge.onNavigate((screen) => {
          if (isNavScreen(screen)) listener(screen);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
  };
}

export function useDesktopNavigation(): { inDesktopApp: boolean } {
  const navigate = useNavigate();
  const [inDesktopApp, setInDesktopApp] = useState(false);
  useEffect(() => {
    const bridge = desktopNavigation();
    if (bridge === null) return;
    setInDesktopApp(true);
    return bridge.onNavigate((screen) => {
      void navigate({ to: navShortcutOf(screen).path });
    });
  }, [navigate]);
  return { inDesktopApp };
}
