import { useEffect, useState } from "react";
import { z } from "zod";
import { DESKTOP_LOGS_GLOBAL } from "@ganger/app/diagnostics/model";

const bridgeSchema = z.object({
  canOpenFolder: z.custom<() => unknown>((value) => typeof value === "function"),
  openFolder: z.custom<() => unknown>((value) => typeof value === "function"),
});

export interface DesktopLogFolder {
  canOpen(): Promise<boolean>;
  open(): Promise<boolean>;
}

export function desktopLogFolder(scope: object = globalThis): DesktopLogFolder | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_LOGS_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  const yes = (value: unknown) => value === true;
  return {
    canOpen: () => Promise.resolve(bridge.canOpenFolder()).then(yes, () => false),
    open: () => Promise.resolve(bridge.openFolder()).then(yes, () => false),
  };
}

export function useDesktopLogFolder(): (() => Promise<boolean>) | null {
  const [open, setOpen] = useState<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    const bridge = desktopLogFolder();
    if (bridge === null) return undefined;
    let live = true;
    void bridge.canOpen().then((can) => {
      if (live && can) setOpen(() => () => bridge.open());
    });
    return () => {
      live = false;
    };
  }, []);
  return open;
}
