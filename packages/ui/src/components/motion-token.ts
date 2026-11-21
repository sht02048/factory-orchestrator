function motionTokenValue(token: unknown): string {
  const name = /var\((--[^,)]+)/.exec(String(token))?.[1];
  if (name === undefined) return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function parseDurationMs(value: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (match === null) return 0;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}

export function motionTokenMs(token: unknown): number {
  return parseDurationMs(motionTokenValue(token));
}

export function motionTokenEasing(token: unknown): string {
  return motionTokenValue(token) || "linear";
}
