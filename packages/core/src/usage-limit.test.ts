import { describe, expect, it } from "vitest";

import type { ProviderUsage } from "./provider-usage.js";
import {
  providerOfAgent,
  USAGE_READING_FRESH_MS,
  usageLimitOf,
  usageLimitsAt,
} from "./usage-limit.js";

const now = new Date(Date.UTC(2026, 10, 19, 9, 0));
const minutes = (value: number) => new Date(now.getTime() + value * 60_000);

function read(providers: ProviderUsage[], readAt: Date = minutes(-1)) {
  return { readAt, reading: { kind: "read" as const, providers } };
}

const claudeAt = (usedPercent: number, resetsAt: Date | null): ProviderUsage => ({
  provider: "claude",
  status: "ok",
  windows: [{ kind: "session", usedPercent, resetsAt }],
});

describe("providerOfAgent", () => {
  it("에이전트 이름이 같은 공급자를 쓰고, 모르는 에이전트는 공급자가 없다", () => {
    expect(providerOfAgent("claude")).toBe("claude");
    expect(providerOfAgent("codex")).toBe("codex");
    expect(providerOfAgent("my-agent")).toBeNull();
  });
});

describe("usageLimitsAt", () => {
  it("100%에 닿고 초기화 시각이 지나지 않은 창의 공급자를 한도로 본다", () => {
    expect(usageLimitsAt(read([claudeAt(100, minutes(68))]), now)).toEqual([
      { provider: "claude", until: minutes(68) },
    ]);
  });

  it("한 공급자의 여러 창이 한도면 가장 늦게 풀리는 시각까지 한도다", () => {
    const usage = read([
      {
        provider: "claude",
        status: "ok",
        windows: [
          { kind: "session", usedPercent: 100, resetsAt: minutes(30) },
          { kind: "weekly", usedPercent: 100, resetsAt: minutes(600) },
          { kind: "fableWeekly", usedPercent: 99, resetsAt: minutes(900) },
        ],
      },
    ]);

    expect(usageLimitsAt(usage, now)).toEqual([{ provider: "claude", until: minutes(600) }]);
  });

  it("초기화 시각이 지나면 다시 후보다", () => {
    expect(usageLimitsAt(read([claudeAt(100, minutes(-1))]), now)).toEqual([]);
    expect(usageLimitsAt(read([claudeAt(100, now)]), now)).toEqual([]);
  });

  it("100% 미만이거나 초기화 시각을 모르면 막지 않는다", () => {
    expect(usageLimitsAt(read([claudeAt(99.9, minutes(60))]), now)).toEqual([]);
    expect(usageLimitsAt(read([claudeAt(100, null)]), now)).toEqual([]);
  });

  it("사용량을 읽지 못했거나 값이 없으면 막지 않는다", () => {
    expect(usageLimitsAt(null, now)).toEqual([]);
    expect(usageLimitsAt({ readAt: minutes(-1), reading: { kind: "unreadable" } }, now)).toEqual(
      [],
    );
    for (const status of ["unavailable", "error", "signed-out"] as const) {
      const usage = read([{ ...claudeAt(100, minutes(60)), status }]);
      expect(usageLimitsAt(usage, now)).toEqual([]);
    }
  });

  it("읽은 지 오래된 값은 막지 않는다", () => {
    const fresh = new Date(now.getTime() - USAGE_READING_FRESH_MS);
    const stale = new Date(now.getTime() - USAGE_READING_FRESH_MS - 1);

    expect(usageLimitsAt(read([claudeAt(100, minutes(60))], fresh), now)).toHaveLength(1);
    expect(usageLimitsAt(read([claudeAt(100, minutes(60))], stale), now)).toEqual([]);
  });
});

describe("usageLimitOf", () => {
  const limits = [{ provider: "claude", until: minutes(60) }];

  it("런의 에이전트가 쓰는 공급자의 한도만 본다", () => {
    expect(usageLimitOf(limits, "claude")).toEqual(limits[0]);
    expect(usageLimitOf(limits, "codex")).toBeNull();
    expect(usageLimitOf(limits, "my-agent")).toBeNull();
  });
});
