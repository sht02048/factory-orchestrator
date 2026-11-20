export interface HideableWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  hide(): void;
  once(event: "leave-full-screen", listener: () => void): unknown;
}

export function hideWindow(window: HideableWindow): void {
  if (!window.isFullScreen()) {
    window.hide();
    return;
  }
  window.once("leave-full-screen", () => window.hide());
  window.setFullScreen(false);
}
