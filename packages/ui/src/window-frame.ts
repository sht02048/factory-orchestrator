export const windowFrame = {
  background: "#090909",
  titleBarHeight: 56,
  railWidth: 84,
} as const;

export const WINDOW_REGION_ATTRIBUTE = "data-app-region";

export type WindowRegion = "drag" | "no-drag";

export function windowRegion(region: WindowRegion): { [WINDOW_REGION_ATTRIBUTE]: WindowRegion } {
  return { [WINDOW_REGION_ATTRIBUTE]: region };
}
