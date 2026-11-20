import { queryOptions } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { RunId } from "@ganger/core";
import type { RunConditions } from "@ganger/app/runs/conditions";
import { RUNNERS_LIST_KEY } from "../runners/runners-query";
import { getRunDetail, getRunsPage } from "../server/functions";
import { TICKET_RUNS_KEY } from "../tickets/tickets-query";

export const runsListKey = ["runs", "list"] as const;

export function runDetailKey(runId: string) {
  return ["runs", "detail", runId] as const;
}

export function keysChangedByRunWrite(runId: RunId): ReadonlyArray<QueryKey> {
  return [
    runDetailKey(runId),
    runsListKey,
    ["dashboard"],
    ["stats"],
    TICKET_RUNS_KEY,
    RUNNERS_LIST_KEY,
    ["settings"],
  ];
}

export interface RunsListParams extends RunConditions {
  ws: string | undefined;
  ended: number;
}

export function runsListQuery(params: RunsListParams, timeZone: string) {
  const { ws, ...rest } = params;
  return queryOptions({
    queryKey: [...runsListKey, { ws: ws ?? "", ...rest }, timeZone] as const,
    queryFn: () => getRunsPage({ data: ws === undefined ? rest : { ...rest, ws } }),
  });
}

export function runDetailQuery(runId: string) {
  return queryOptions({
    queryKey: runDetailKey(runId),
    queryFn: () => getRunDetail({ data: { runId } }),
  });
}
