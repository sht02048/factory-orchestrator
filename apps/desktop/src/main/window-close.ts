export interface HideableWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  hide(): void;
  once(event: "leave-full-screen", listener: () => void): unknown;
  removeListener(event: "leave-full-screen", listener: () => void): unknown;
}

const hidesAfterFullScreen = new WeakMap<HideableWindow, () => void>();

export function hideWindow(window: HideableWindow): void {
  cancelPendingHide(window);
  if (!window.isFullScreen()) {
    window.hide();
    return;
  }
  const hideAfterLeaving = (): void => {
    hidesAfterFullScreen.delete(window);
    window.hide();
  };
  hidesAfterFullScreen.set(window, hideAfterLeaving);
  window.once("leave-full-screen", hideAfterLeaving);
  window.setFullScreen(false);
}

export function cancelPendingHide(window: HideableWindow): void {
  const pending = hidesAfterFullScreen.get(window);
  if (pending === undefined) return;
  hidesAfterFullScreen.delete(window);
  window.removeListener("leave-full-screen", pending);
}
