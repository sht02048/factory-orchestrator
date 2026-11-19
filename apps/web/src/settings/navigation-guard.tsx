import { useBlocker } from "@tanstack/react-router";

export interface UnsavedGuard {
  hold: () => boolean;
}

export function NavigationGuard({ hold }: UnsavedGuard) {
  useBlocker({ shouldBlockFn: hold, enableBeforeUnload: false });
  return null;
}
