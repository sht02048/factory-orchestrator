import { USAGE_LIMIT_PERCENT } from "./provider-usage.js";
import type { ProviderUsageReading } from "./provider-usage.js";

export const USAGE_READING_FRESH_MS = 30 * 60_000;

const PROVIDER_OF_AGENT: ReadonlyMap<string, string> = new Map([
  ["claude", "claude"],
  ["codex", "codex"],
]);

export function providerOfAgent(agent: string): string | null {
  return PROVIDER_OF_AGENT.get(agent) ?? null;
}

export interface UsageLimit {
  provider: string;
  until: Date;
}

export interface ProviderUsageSnapshot {
  readAt: Date;
  reading: ProviderUsageReading;
}

export function usageLimitsAt(usage: ProviderUsageSnapshot | null, now: Date): UsageLimit[] {
  if (usage === null || usage.reading.kind !== "read") return [];
  if (now.getTime() - usage.readAt.getTime() > USAGE_READING_FRESH_MS) return [];
  const untilByProvider = new Map<string, number>();
  for (const provider of usage.reading.providers) {
    if (provider.status !== "ok") continue;
    for (const window of provider.windows) {
      if (window.usedPercent < USAGE_LIMIT_PERCENT || window.resetsAt === null) continue;
      const resetsAt = window.resetsAt.getTime();
      if (resetsAt <= now.getTime()) continue;
      const until = untilByProvider.get(provider.provider);
      untilByProvider.set(
        provider.provider,
        until === undefined ? resetsAt : Math.max(until, resetsAt),
      );
    }
  }
  return [...untilByProvider].map(([provider, until]) => ({ provider, until: new Date(until) }));
}

export function usageLimitOf(limits: ReadonlyArray<UsageLimit>, agent: string): UsageLimit | null {
  const provider = providerOfAgent(agent);
  if (provider === null) return null;
  return limits.find((limit) => limit.provider === provider) ?? null;
}
