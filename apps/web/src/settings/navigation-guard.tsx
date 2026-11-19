import { useBlocker } from "@tanstack/react-router";

export interface UnsavedGuard {
  isDirty: () => boolean;
  onBlocked: () => void;
}

export function NavigationGuard({ isDirty, onBlocked }: UnsavedGuard) {
  useBlocker({
    shouldBlockFn: () => {
      if (!isDirty()) return false;
      onBlocked();
      return true;
    },
    enableBeforeUnload: isDirty,
  });
  return null;
}
