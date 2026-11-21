function motionTokenValue(token: unknown): string {
  const name = /var\((--[^,)]+)/.exec(String(token))?.[1];
  if (name === undefined) return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function motionTokenMs(token: unknown): number {
  const value = Number.parseFloat(motionTokenValue(token));
  return Number.isFinite(value) ? value : 0;
}

export function motionTokenEasing(token: unknown): string {
  return motionTokenValue(token) || "linear";
}
