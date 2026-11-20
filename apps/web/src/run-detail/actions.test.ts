import { MutationObserver, QueryObserver, environmentManager } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { rootRouteId } from "@tanstack/react-router";
import { loadRunDetail } from "@ganger/app/run-detail/load";
import type { RunDetail, RunDetailPage } from "@ganger/app/run-detail/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MutationRejectedError } from "../query/mutation-error";
import { createQueryClient } from "../query/query-client";
import { runDetailKey } from "../runs/queries";
import { now, seedDatabase } from "../testing/seed";
import {
  LOG_POLL_LIMIT,
  RUN_POLL_MS,
  fetchCountOf,
  isUnmovedScreen,
  runDetailMutations,
  runDetailPollMs,
} from "./actions";
import type { RunDetailCalls } from "./actions";

const RUN_ID = "run-1";
const OTHER_RUN_ID = "run-2";

const KEYS_IN_CACHE: ReadonlyArray<QueryKey> = [
  runDetailKey(RUN_ID),
  runDetailKey(OTHER_RUN_ID),
  ["runs", "list", { ws: "" }, "UTC"],
  ["dashboard", "", "UTC"],
  ["tickets", "runs", ""],
  ["runners", "list"],
  ["stats", "", 7, "UTC"],
  ["shell"],
];

function runningDetail(): RunDetail {
  const { db, ids } = seedDatabase();
  const id = ids.get("ACME-10");
  if (id === undefined) throw new Error("no running run");
  const page = loadRunDetail(db, id, now);
  if (page.kind !== "found") throw new Error("not found");
  return page.run;
}

const running = runningDetail();

function pageWith(changes: Partial<RunDetail>): RunDetailPage {
  return { kind: "found", run: { ...running, ...changes } };
}

function okCalls(overrides: Partial<RunDetailCalls> = {}): RunDetailCalls {
  return {
    answer: () => Promise.resolve(undefined),
    deny: () => Promise.resolve(undefined),
    cancel: () => Promise.resolve({ ok: true }),
    control: () => Promise.resolve({ ok: true }),
    requestLog: () => Promise.resolve(true),
    ...overrides,
  };
}

function mutationWorld(calls: RunDetailCalls) {
  const queryClient = createQueryClient();
  for (const queryKey of KEYS_IN_CACHE) queryClient.setQueryData(queryKey, "cached");
  const refreshUnmovedScreens = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const logRequested = vi.fn<() => void>();
  const mutations = runDetailMutations(
    { queryClient, calls, refreshUnmovedScreens, logRequested },
    RUN_ID,
  );
  const invalidated = (): QueryKey[] =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);
  return { queryClient, mutations, refreshUnmovedScreens, logRequested, invalidated };
}

function mutate<TData, TVariables>(
  queryClient: QueryClient,
  options: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
  variables: TVariables,
): Promise<TData> {
  return new MutationObserver<TData, Error, TVariables>(queryClient, options).mutate(variables);
}

describe("Run 상세 mutation(스펙 0003 4.4, C5)", () => {
  it("답하기가 성공하면 그 런의 상세와 Runs 목록만 무효화하고 아직 옮기지 않은 화면을 함께 다시 읽게 한다", async () => {
    const world = mutationWorld(okCalls());
    await mutate(world.queryClient, world.mutations.answer, { questionId: "q-1", answer: "네" });

    expect(world.invalidated()).toEqual([
      runDetailKey(RUN_ID),
      ["runs", "list", { ws: "" }, "UTC"],
    ]);
    expect(world.refreshUnmovedScreens).toHaveBeenCalledTimes(1);
  });

  it("거절·취소·멈추기도 성공하면 같은 두 key만 무효화한다", async () => {
    const deny = mutationWorld(okCalls());
    await mutate(deny.queryClient, deny.mutations.deny, { promptId: "p-1", reason: "" });
    const cancel = mutationWorld(okCalls());
    await mutate(cancel.queryClient, cancel.mutations.cancel, undefined);
    const pause = mutationWorld(okCalls());
    await mutate(pause.queryClient, pause.mutations.control, "pause");

    for (const world of [deny, cancel, pause]) {
      expect(world.invalidated()).toEqual([
        runDetailKey(RUN_ID),
        ["runs", "list", { ws: "" }, "UTC"],
      ]);
    }
  });

  it("취소의 ok:false는 이유가 담긴 오류로 throw하고 아무 key도 무효화하지 않는다", async () => {
    const world = mutationWorld(
      okCalls({ cancel: () => Promise.resolve({ ok: false, reason: "not-cancelable" }) }),
    );
    const failure = mutate(world.queryClient, world.mutations.cancel, undefined);

    await expect(failure).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(failure).rejects.toMatchObject({ reason: "not-cancelable" });
    expect(world.invalidated()).toEqual([]);
    expect(world.refreshUnmovedScreens).not.toHaveBeenCalled();
  });

  it("서버 함수 경계를 넘어 message만 남은 답 거절도 이유가 담긴 같은 오류가 된다", async () => {
    const world = mutationWorld(
      okCalls({ answer: () => Promise.reject(new Error("answer rejected: already-answered")) }),
    );
    const failure = mutate(world.queryClient, world.mutations.answer, {
      questionId: "q-1",
      answer: "네",
    });

    await expect(failure).rejects.toMatchObject({
      name: "MutationRejectedError",
      reason: "already-answered",
    });
  });

  it("권한 거절이 throw한 이유도 같은 오류 타입으로 바꾼다", async () => {
    const world = mutationWorld(
      okCalls({ deny: () => Promise.reject(new Error("deny rejected: resolved")) }),
    );
    const failure = mutate(world.queryClient, world.mutations.deny, {
      promptId: "p-1",
      reason: "",
    });

    await expect(failure).rejects.toMatchObject({
      name: "MutationRejectedError",
      reason: "resolved",
    });
  });

  it("멈추기·재개의 ok:false는 오류가 아니라 '상태가 바뀜'이고, 그래도 그 런의 key를 무효화한다", async () => {
    const world = mutationWorld(
      okCalls({ control: () => Promise.resolve({ ok: false, reason: "not-running" }) }),
    );
    const outcome = await mutate(world.queryClient, world.mutations.control, "pause");

    expect(outcome).toBe("state-changed");
    expect(world.invalidated()).toEqual([
      runDetailKey(RUN_ID),
      ["runs", "list", { ws: "" }, "UTC"],
    ]);
  });

  it("로그 다시 받기는 그 런의 상세만 무효화하고 로그 폴링을 새로 센다", async () => {
    const world = mutationWorld(okCalls());
    await mutate(world.queryClient, world.mutations.refreshLog, undefined);

    expect(world.invalidated()).toEqual([runDetailKey(RUN_ID)]);
    expect(world.refreshUnmovedScreens).not.toHaveBeenCalled();
    expect(world.logRequested).toHaveBeenCalledTimes(1);
  });

  it("열 때 로그 요청은 요청이 남았을 때만 그 런의 상세를 무효화한다", async () => {
    const requested = mutationWorld(okCalls());
    await mutate(requested.queryClient, requested.mutations.openLog, undefined);
    expect(requested.invalidated()).toEqual([runDetailKey(RUN_ID)]);

    const ended = mutationWorld(okCalls({ requestLog: () => Promise.resolve(false) }));
    await mutate(ended.queryClient, ended.mutations.openLog, undefined);
    expect(ended.invalidated()).toEqual([]);
    expect(ended.logRequested).not.toHaveBeenCalled();
  });
});

describe("아직 옮기지 않은 화면 고르기(스펙 0003 6절 3번)", () => {
  it("루트, 셸, Runs, Run 상세는 고르지 않고 나머지 route는 고른다", () => {
    const picked = [
      rootRouteId,
      "/_app",
      "/_app/runs",
      "/_app/runs_/$runId",
      "/_app/",
      "/_app/tickets",
      "/_app/stats",
    ].filter((routeId) => isUnmovedScreen({ routeId }));

    expect(picked).toEqual(["/_app/", "/_app/tickets", "/_app/stats"]);
  });
});

describe("처리 중 폴링(스펙 0003 4.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    environmentManager.setIsServer(() => false);
  });

  afterEach(() => {
    environmentManager.setIsServer(() => typeof window === "undefined");
    vi.useRealTimers();
  });

  function pollingWorld(pageAt: (fetches: number) => RunDetailPage) {
    const queryClient = createQueryClient();
    const fetchedAt: number[] = [];
    const queryKey = runDetailKey(RUN_ID);
    const queryFn = () => {
      fetchedAt.push(Date.now());
      return Promise.resolve(pageAt(fetchedAt.length));
    };
    let logPollsFrom = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      refetchInterval: (query) =>
        query.state.data === undefined
          ? false
          : runDetailPollMs(query.state.data, fetchCountOf(query.state) - logPollsFrom),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const startLogPolls = () => {
      const state = queryClient.getQueryState(queryKey);
      logPollsFrom = state === undefined ? 0 : fetchCountOf(state);
      observer.setOptions({ ...observer.options });
    };
    return { fetchedAt, unsubscribe, startLogPolls };
  }

  it("로그 받는 중이면 2초 간격으로 최대 15번 다시 읽고 멈춘다", async () => {
    const world = pollingWorld(() => pageWith({ log: { kind: "pending" } }));
    await vi.advanceTimersByTimeAsync(0);
    world.startLogPolls();
    const startedAt = Date.now();

    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * (LOG_POLL_LIMIT + 10));
    world.unsubscribe();

    const polls = world.fetchedAt.slice(1).map((at) => at - startedAt);
    expect(polls).toEqual(Array.from({ length: LOG_POLL_LIMIT }, (_, i) => (i + 1) * RUN_POLL_MS));
  });

  it("로그가 도착하면 15번 전이라도 멈춘다", async () => {
    const world = pollingWorld((fetches) =>
      pageWith({
        log: fetches < 4 ? { kind: "pending" } : { kind: "done", lines: ["ok"], at: running.now },
      }),
    );
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * (LOG_POLL_LIMIT + 10));
    world.unsubscribe();

    expect(world.fetchedAt).toHaveLength(4);
  });

  it("멈추기·재개 처리 중이면 끝날 때까지 2초마다 다시 읽는다(15번 제한 없음)", async () => {
    const pendingFetches = LOG_POLL_LIMIT + 5;
    const world = pollingWorld((fetches) =>
      pageWith({
        log: { kind: "none" },
        control: fetches <= pendingFetches ? { control: "pause", status: "pending" } : null,
      }),
    );
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * (pendingFetches + 10));
    world.unsubscribe();

    expect(world.fetchedAt).toHaveLength(pendingFetches + 1);
  });
});
