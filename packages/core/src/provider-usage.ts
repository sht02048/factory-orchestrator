export const USAGE_WINDOW_KINDS = ["session", "weekly", "fableWeekly", "monthly"] as const;

export type UsageWindowKind = (typeof USAGE_WINDOW_KINDS)[number];

export const USAGE_HIGH_PERCENT = 90;
export const USAGE_LIMIT_PERCENT = 100;

export interface UsageWindow {
  kind: UsageWindowKind;
  usedPercent: number;
  resetsAt: Date | null;
}

export type ProviderUsageStatus = "ok" | "signed-out" | "unavailable" | "error";

export interface ProviderUsage {
  provider: string;
  status: ProviderUsageStatus;
  windows: ReadonlyArray<UsageWindow>;
}

export type ProviderUsageReading =
  | { kind: "read"; providers: ReadonlyArray<ProviderUsage> }
  | { kind: "unreadable" };

export interface ProviderWindowUsage {
  provider: string;
  window: UsageWindow;
}

function windowsOf(providers: ReadonlyArray<ProviderUsage>): ProviderWindowUsage[] {
  return providers
    .filter((usage) => usage.status === "ok")
    .flatMap((usage) => usage.windows.map((window) => ({ provider: usage.provider, window })));
}

export function highestUsage(providers: ReadonlyArray<ProviderUsage>): ProviderWindowUsage | null {
  let highest: ProviderWindowUsage | null = null;
  for (const entry of windowsOf(providers)) {
    if (highest === null || entry.window.usedPercent > highest.window.usedPercent) highest = entry;
  }
  return highest;
}

export function reachedUsageLimits(providers: ReadonlyArray<ProviderUsage>): ProviderWindowUsage[] {
  return windowsOf(providers).filter((entry) => entry.window.usedPercent >= USAGE_LIMIT_PERCENT);
}

export function currentWindows(
  providers: ReadonlyArray<ProviderUsage>,
  now: Date,
): ProviderUsage[] {
  return providers.map((usage) => ({
    ...usage,
    windows: usage.windows.filter(
      (window) => window.resetsAt === null || window.resetsAt.getTime() > now.getTime(),
    ),
  }));
}
