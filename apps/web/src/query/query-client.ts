import { QueryClient } from "@tanstack/react-query";

export const DB_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 5 * 60_000;
export const READ_RETRY_COUNT = 1;
export const PRELOAD_FRESH_MS = 5_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DB_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: READ_RETRY_COUNT,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });
}
