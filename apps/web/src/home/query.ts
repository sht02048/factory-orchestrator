import { queryOptions } from "@tanstack/react-query";
import { hasPendingControl } from "@ganger/app/home/model";
import type { HomePage } from "@ganger/app/home/model";
import { getHomePage } from "../server/functions";

export const CONTROL_POLL_MS = 2_000;

export function pollWhileControlPending(query: {
  state: { data: Pick<HomePage, "running"> | undefined };
}): number | false {
  const page = query.state.data;
  return page !== undefined && hasPendingControl(page) ? CONTROL_POLL_MS : false;
}

export function dashboardQuery(ws: string | undefined, timeZone: string) {
  return queryOptions({
    queryKey: ["dashboard", ws ?? null, timeZone] as const,
    queryFn: () => getHomePage({ data: { ws } }),
    refetchInterval: pollWhileControlPending,
  });
}
