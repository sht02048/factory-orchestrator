import { describe, expect, it } from "vitest";
import { currentWindows, highestUsage, reachedUsageLimits } from "./provider-usage.js";
import type { ProviderUsage } from "./provider-usage.js";

const providers: ProviderUsage[] = [
  {
    provider: "claude",
    status: "ok",
    windows: [
      { kind: "session", usedPercent: 100, resetsAt: new Date(1_000) },
      { kind: "weekly", usedPercent: 72, resetsAt: null },
    ],
  },
  {
    provider: "codex",
    status: "ok",
    windows: [{ kind: "weekly", usedPercent: 40, resetsAt: null }],
  },
  {
    provider: "gemini",
    status: "error",
    windows: [{ kind: "weekly", usedPercent: 120, resetsAt: null }],
  },
];

describe("highestUsage", () => {
  it("읽은 공급자의 창 중 가장 높은 값을 고른다", () => {
    expect(highestUsage(providers)).toEqual({
      provider: "claude",
      window: { kind: "session", usedPercent: 100, resetsAt: new Date(1_000) },
    });
  });

  it("읽은 창이 없으면 null이다", () => {
    expect(highestUsage([{ provider: "codex", status: "signed-out", windows: [] }])).toBeNull();
    expect(highestUsage([])).toBeNull();
  });
});

describe("reachedUsageLimits", () => {
  it("100%에 닿은 창만 고른다", () => {
    expect(reachedUsageLimits(providers)).toEqual([
      {
        provider: "claude",
        window: { kind: "session", usedPercent: 100, resetsAt: new Date(1_000) },
      },
    ]);
  });
});

describe("currentWindows", () => {
  it("초기화 시각이 지난 창은 값이 낡아 뺀다", () => {
    const windows = currentWindows(providers, new Date(1_000));
    expect(windows[0]?.windows).toEqual([{ kind: "weekly", usedPercent: 72, resetsAt: null }]);
    expect(currentWindows(providers, new Date(999))[0]?.windows).toHaveLength(2);
  });
});
