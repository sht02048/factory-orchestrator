import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getRunnersPage } from "../server/functions";
import { getRunnerChecksPending } from "../server/settings-functions";
import { SHELL_KEY } from "../shell/shell-query";

export const RUNNERS_LIST_KEY = ["runners", "list"] as const;
export const RUNNER_CHECKS_PENDING_KEY = ["runners", "checks-pending"] as const;

export const runnersQuery = queryOptions({
  queryKey: RUNNERS_LIST_KEY,
  queryFn: () => getRunnersPage(),
});

export const runnerChecksPendingQuery = queryOptions({
  queryKey: RUNNER_CHECKS_PENDING_KEY,
  queryFn: () => getRunnerChecksPending(),
  staleTime: 0,
});

export async function refreshRunnersAndShell(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: RUNNERS_LIST_KEY }),
    queryClient.invalidateQueries({ queryKey: SHELL_KEY }),
  ]);
}

export async function runnerChecksStillPending(queryClient: QueryClient): Promise<boolean> {
  const pending = await queryClient.query(runnerChecksPendingQuery);
  if (!pending) await refreshRunnersAndShell(queryClient);
  return pending;
}
