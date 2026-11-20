import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { TrackerTicketsData } from "@ganger/app/tickets/model";
import { DB_STALE_TIME_MS } from "../query/query-client";
import { getTicketRuns, getTrackerTickets } from "../server/functions";

export const TRACKER_STALE_TIME_MS = 5 * 60_000;
export const TRACKER_KEY = ["tracker"] as const;
export const TICKET_RUNS_KEY = ["tickets", "runs"] as const;

function wsKey(ws: string | undefined): string {
  return ws ?? "";
}

export function ticketRunsQuery(ws: string | undefined) {
  return queryOptions({
    queryKey: [...TICKET_RUNS_KEY, wsKey(ws)],
    queryFn: () => getTicketRuns({ data: { ws } }),
  });
}

export function trackerLabelsKey(connectionId: string, projectId: string) {
  return [...TRACKER_KEY, "labels", connectionId, projectId] as const;
}

export function trackerStaleTime(data: TrackerTicketsData | undefined): number {
  return data !== undefined && data.errors.length > 0 ? DB_STALE_TIME_MS : TRACKER_STALE_TIME_MS;
}

export function trackerTicketsQuery(queryClient: QueryClient, ws: string | undefined) {
  return queryOptions({
    queryKey: [...TRACKER_KEY, "tickets", wsKey(ws)],
    queryFn: async () => {
      const data = await getTrackerTickets({ data: { ws } });
      for (const project of data.labels) {
        queryClient.setQueryData(
          trackerLabelsKey(project.connection, project.projectId),
          project.labels,
        );
      }
      return data;
    },
    staleTime: (query) => trackerStaleTime(query.state.data),
  });
}
