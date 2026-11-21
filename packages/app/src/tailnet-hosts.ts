import type { ThisTailnetAddresses } from "./tailscale.js";

export const TAILNET_HOSTS_REFRESH_MS = 15_000;

export interface TailnetHostsCache {
  hosts(): ReadonlyArray<string>;
  refresh(): Promise<void>;
}

export function createTailnetHostsCache(
  read: () => Promise<ThisTailnetAddresses>,
  now: () => number = Date.now,
  refreshMs: number = TAILNET_HOSTS_REFRESH_MS,
): TailnetHostsCache {
  let hosts: ReadonlyArray<string> = [];
  let readAt: number | null = null;
  let reading: Promise<void> | null = null;
  const readOnce = async () => {
    const result = await read().catch((): ThisTailnetAddresses => ({ kind: "unknown" }));
    if (result.kind === "known") hosts = result.hosts;
    if (result.kind === "none") hosts = [];
    readAt = now();
    reading = null;
  };
  return {
    hosts: () => hosts,
    refresh: () => {
      if (reading !== null) return reading;
      if (readAt !== null && now() - readAt < refreshMs) return Promise.resolve();
      reading = readOnce();
      return reading;
    },
  };
}
