import { describe, expect, it } from "vitest";
import { PRELOAD_FRESH_MS } from "./query/query-client";
import { Route as onboardingRoute } from "./routes/onboarding";
import { getRouter } from "./router";

describe("라우터 미리 읽기 신선도(스펙 0003 4.2, 0129)", () => {
  it("Query로 옮긴 화면은 라우터가 미리 읽은 결과를 담아 두지 않는다", () => {
    expect(getRouter().options.defaultPreloadStaleTime).toBe(0);
  });

  it("라우터 로더로 남은 온보딩은 포인터를 올릴 때마다 다시 읽지 않게 5초를 둔다", () => {
    expect(onboardingRoute.options.preloadStaleTime).toBe(PRELOAD_FRESH_MS);
  });
});
