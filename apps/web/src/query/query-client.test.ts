import { describe, expect, it } from "vitest";
import {
  DB_STALE_TIME_MS,
  QUERY_GC_TIME_MS,
  READ_RETRY_COUNT,
  createQueryClient,
} from "./query-client";

describe("createQueryClient(스펙 0003 4.2, C6)", () => {
  it("DB 데이터 기본값은 staleTime 30초, gcTime 5분, 읽기 retry 1, 창 포커스·재연결 때 다시 읽기다", () => {
    const queries = createQueryClient().getDefaultOptions().queries;

    expect(DB_STALE_TIME_MS).toBe(30_000);
    expect(QUERY_GC_TIME_MS).toBe(300_000);
    expect(READ_RETRY_COUNT).toBe(1);
    expect(queries).toMatchObject({
      staleTime: DB_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      retry: READ_RETRY_COUNT,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    });
  });

  it("로더가 쓰는 queryClient.query에도 기본 retry가 먹는다(그 API의 기본은 retry: false)", async () => {
    const queryClient = createQueryClient();
    let calls = 0;
    const data = await queryClient.query({
      queryKey: ["retry-probe"],
      queryFn: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("first read fails")) : Promise.resolve("ok");
      },
      retryDelay: 0,
    });

    expect(data).toBe("ok");
    expect(calls).toBe(1 + READ_RETRY_COUNT);
  });

  it("읽기는 retry 1번 뒤에도 실패하면 throw한다", async () => {
    const queryClient = createQueryClient();
    let calls = 0;
    const read = queryClient.query({
      queryKey: ["retry-fails"],
      queryFn: () => {
        calls += 1;
        return Promise.reject(new Error("always fails"));
      },
      retryDelay: 0,
    });

    await expect(read).rejects.toThrow("always fails");
    expect(calls).toBe(2);
  });

  it("요청마다 새 QueryClient를 만든다", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
