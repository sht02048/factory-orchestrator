import type {
  DefaultError,
  QueryClient,
  QueryExecuteOptions,
  QueryKey,
} from "@tanstack/react-query";

export const PRELOAD_FRESH_MS = 5_000;

export interface RouteQueryLoad {
  context: { queryClient: QueryClient };
  preload: boolean;
  cause: "preload" | "enter" | "stay";
}

type RouteQueryOptions<TQueryFnData, TError, TQueryKey extends QueryKey> = QueryExecuteOptions<
  TQueryFnData,
  TError,
  TQueryFnData,
  TQueryFnData,
  TQueryKey
>;

const preloadedDataAt = new WeakMap<QueryClient, Map<string, number>>();

function preloadedOf(queryClient: QueryClient): Map<string, number> {
  const existing = preloadedDataAt.get(queryClient);
  if (existing !== undefined) return existing;
  const created = new Map<string, number>();
  preloadedDataAt.set(queryClient, created);
  return created;
}

function queryHashOf(queryClient: QueryClient, queryKey: QueryKey): string {
  return queryClient.defaultQueryOptions({ queryKey }).queryHash;
}

function dataUpdatedAtOf(queryClient: QueryClient, queryKey: QueryKey): number | undefined {
  const state = queryClient.getQueryState(queryKey);
  return state?.data === undefined ? undefined : state.dataUpdatedAt;
}

function inBrowser(): boolean {
  return typeof document !== "undefined";
}

async function preloadRouteQuery<TQueryFnData, TError, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: RouteQueryOptions<TQueryFnData, TError, TQueryKey>,
): Promise<TQueryFnData> {
  const before = dataUpdatedAtOf(queryClient, options.queryKey);
  const data = await queryClient.query(options);
  const after = dataUpdatedAtOf(queryClient, options.queryKey);
  if (after !== undefined && after !== before) {
    preloadedOf(queryClient).set(queryHashOf(queryClient, options.queryKey), after);
  }
  return data;
}

function takeFreshPreload(queryClient: QueryClient, queryKey: QueryKey): boolean {
  const preloaded = preloadedOf(queryClient);
  const hash = queryHashOf(queryClient, queryKey);
  const preloadedAt = preloaded.get(hash);
  preloaded.delete(hash);
  return (
    preloadedAt !== undefined &&
    preloadedAt === dataUpdatedAtOf(queryClient, queryKey) &&
    Date.now() - preloadedAt < PRELOAD_FRESH_MS
  );
}

export async function loadRouteQuery<
  TQueryFnData,
  TError = DefaultError,
  TQueryKey extends QueryKey = QueryKey,
>(
  load: RouteQueryLoad,
  options: RouteQueryOptions<TQueryFnData, TError, TQueryKey>,
): Promise<TQueryFnData> {
  const queryClient = load.context.queryClient;
  if (load.preload) return preloadRouteQuery(queryClient, options);

  const cachedBeforeEnter = dataUpdatedAtOf(queryClient, options.queryKey) !== undefined;
  const data = await queryClient.query({ ...options, staleTime: "static" });
  const revalidate =
    inBrowser() &&
    load.cause === "enter" &&
    cachedBeforeEnter &&
    !takeFreshPreload(queryClient, options.queryKey);
  if (revalidate) {
    queryClient.query({ ...options, staleTime: 0 }).catch(() => undefined);
  }
  return data;
}

export async function loadCachedRouteQuery<
  TQueryFnData,
  TError = DefaultError,
  TQueryKey extends QueryKey = QueryKey,
>(
  load: RouteQueryLoad,
  options: RouteQueryOptions<TQueryFnData, TError, TQueryKey>,
): Promise<TQueryFnData> {
  const queryClient = load.context.queryClient;
  if (load.preload) return preloadRouteQuery(queryClient, options);
  const data = await queryClient.query({ ...options, staleTime: "static" });
  if (inBrowser() && load.cause === "enter") queryClient.query(options).catch(() => undefined);
  return data;
}
