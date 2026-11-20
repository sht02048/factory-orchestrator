import { queryOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_STALE_TIME_MS, PRELOAD_FRESH_MS, createQueryClient } from "./query-client";
import { loadCachedRouteQuery, loadRouteQuery } from "./route-query";
import type { RouteQueryLoad } from "./route-query";

function probeWorld() {
  const queryClient = createQueryClient();
  const held: Array<() => void> = [];
  let calls = 0;
  let hold = false;
  const probeQuery = queryOptions({
    queryKey: ["probe"],
    queryFn: () => {
      calls += 1;
      const answer = `answer-${calls}`;
      if (!hold) return Promise.resolve(answer);
      return new Promise<string>((resolve) => {
        held.push(() => resolve(answer));
      });
    },
  });
  const load = (kind: "preload" | "enter" | "stay"): RouteQueryLoad => ({
    context: { queryClient },
    preload: kind === "preload",
    cause: kind,
  });

  return {
    queryClient,
    calls: () => calls,
    cached: () => queryClient.getQueryData(probeQuery.queryKey),
    holdFetches: () => {
      hold = true;
    },
    releaseFetches: () => {
      for (const release of held.splice(0)) release();
    },
    preload: () => loadRouteQuery(load("preload"), probeQuery),
    enter: () => loadRouteQuery(load("enter"), probeQuery),
    stay: () => loadRouteQuery(load("stay"), probeQuery),
    cachedPreload: (staleTime: number) =>
      loadCachedRouteQuery(load("preload"), { ...probeQuery, staleTime }),
    cachedEnter: (staleTime: number) =>
      loadCachedRouteQuery(load("enter"), { ...probeQuery, staleTime }),
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.stubGlobal("document", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadRouteQuery(스펙 0003 4.2)", () => {
  it("처음 들어가는 화면은 query를 한 번 읽고 그 값을 기다린다", async () => {
    const world = probeWorld();

    const data = await world.enter();
    await flush();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(1);
  });

  it("다시 들어간 화면은 기다리지 않고 캐시로 그리고 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();
    await world.enter();
    vi.advanceTimersByTime(1_000);

    world.holdFetches();
    const data = await world.enter();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(2);
    world.releaseFetches();
    await flush();
    expect(world.cached()).toBe("answer-2");
  });

  it("이번 이동을 위해 5초 안에 미리 읽은 화면은 들어갈 때 다시 읽지 않는다", async () => {
    const world = probeWorld();

    await world.preload();
    vi.advanceTimersByTime(PRELOAD_FRESH_MS - 1);
    const data = await world.enter();
    await flush();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(1);
  });

  it("미리 읽은 지 5초가 지나 들어가면 캐시로 그리고 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();

    await world.preload();
    vi.advanceTimersByTime(PRELOAD_FRESH_MS);
    const data = await world.enter();
    await flush();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(2);
  });

  it("미리 읽기 표시는 한 번만 쓴다. 나갔다가 다시 들어오면 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();
    await world.preload();
    await world.enter();

    await world.enter();
    await flush();

    expect(world.calls()).toBe(2);
  });

  it("서버 렌더로 받은 캐시가 있는 화면을 떠났다가 1~2초 안에 돌아와도 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();
    world.queryClient.setQueryData(["probe"], "from-server");
    vi.advanceTimersByTime(1_500);

    const data = await world.enter();
    await flush();

    expect(data).toBe("from-server");
    expect(world.calls()).toBe(1);
  });

  it("한 번 본 화면을 staleTime 안에 미리 읽으면 요청하지 않고, 들어갈 때 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();
    await world.enter();
    vi.advanceTimersByTime(DB_STALE_TIME_MS - 1);

    await world.preload();
    expect(world.calls()).toBe(1);
    await world.enter();
    await flush();

    expect(world.calls()).toBe(2);
  });

  it("한 번 본 화면을 staleTime이 지나 미리 읽으면 새로 읽고, 바로 들어가면 더 읽지 않는다", async () => {
    const world = probeWorld();
    await world.enter();
    vi.advanceTimersByTime(DB_STALE_TIME_MS);

    await world.preload();
    expect(world.calls()).toBe(2);
    const data = await world.enter();
    await flush();

    expect(data).toBe("answer-2");
    expect(world.calls()).toBe(2);
  });

  it("미리 읽기가 아직 도는 중에 들어가면 그 요청을 함께 기다리고 더 읽지 않는다", async () => {
    const world = probeWorld();
    world.holdFetches();

    const preloading = world.preload();
    const entering = world.enter();
    world.releaseFetches();

    await expect(entering).resolves.toBe("answer-1");
    await preloading;
    await flush();
    expect(world.calls()).toBe(1);
  });

  it("같은 화면에 머무는 다시 읽기(cause stay)는 뒤에서 새로 읽지 않는다", async () => {
    const world = probeWorld();
    await world.enter();
    vi.advanceTimersByTime(PRELOAD_FRESH_MS);

    await world.stay();
    await flush();

    expect(world.calls()).toBe(1);
  });

  it("서버에서는 같은 요청 안의 캐시를 쓰고 뒤에서 다시 읽지 않는다", async () => {
    vi.unstubAllGlobals();
    const world = probeWorld();
    world.queryClient.setQueryData(["probe"], "same-request");

    const data = await world.enter();
    await flush();

    expect(data).toBe("same-request");
    expect(world.calls()).toBe(0);
  });
});

describe("loadCachedRouteQuery(0127, 다시 들어가도 staleTime 을 지키는 query)", () => {
  const FIVE_MINUTES = 5 * 60_000;

  it("다시 들어가면 staleTime 안에서는 캐시만 쓰고 뒤에서 읽지 않는다", async () => {
    const world = probeWorld();
    await world.cachedEnter(FIVE_MINUTES);
    vi.advanceTimersByTime(FIVE_MINUTES - 1);

    const data = await world.cachedEnter(FIVE_MINUTES);
    await flush();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(1);
  });

  it("다시 들어갈 때 staleTime 이 지났으면 캐시를 바로 돌려주고 뒤에서 새로 읽는다", async () => {
    const world = probeWorld();
    const ONE_MINUTE = 60_000;
    await world.cachedEnter(ONE_MINUTE);
    vi.advanceTimersByTime(ONE_MINUTE * 2);
    world.holdFetches();

    const data = await world.cachedEnter(ONE_MINUTE);
    await flush();

    expect(data).toBe("answer-1");
    expect(world.calls()).toBe(2);
    world.releaseFetches();
    await flush();
    expect(world.cached()).toBe("answer-2");
  });

  it("미리 읽기는 staleTime 안이면 읽지 않고 지나면 읽는다", async () => {
    const world = probeWorld();
    await world.cachedEnter(FIVE_MINUTES);

    vi.advanceTimersByTime(FIVE_MINUTES - 1);
    await world.cachedPreload(FIVE_MINUTES);
    expect(world.calls()).toBe(1);

    vi.advanceTimersByTime(2);
    await world.cachedPreload(FIVE_MINUTES);
    expect(world.calls()).toBe(2);
  });
});
