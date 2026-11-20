import { queryOptions } from "@tanstack/react-query";
import type { StatsPeriodDays } from "@ganger/app/stats/model";
import { getStatsPage } from "../server/functions";

export function statsQuery(ws: string | undefined, days: StatsPeriodDays, timeZone: string) {
  return queryOptions({
    queryKey: ["stats", ws ?? null, days, timeZone] as const,
    queryFn: ({ signal }) => getStatsPage({ data: { ws, days }, signal }),
  });
}
