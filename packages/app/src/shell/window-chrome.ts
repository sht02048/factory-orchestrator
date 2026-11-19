export const TITLE_BAR_COOKIE = "ganger-title-bar";
export const HIDDEN_TITLE_BAR = "hidden";

export function isTitleBarHidden(cookie: string | undefined): boolean {
  return cookie === HIDDEN_TITLE_BAR;
}
